// Solana transaction → review model. Every instruction except compute budget is an action;
// compute budget folds into the fee row ("incl. priority fee" + Fee details).

import { formatLamports, type DecodedSolanaIx } from "../chains/solanaIx";
import type { DecodedSolanaTx } from "../chains/solanaTx";
import { amountText, amountUsd, buildTotal, fromRow, mergeAmounts, partyOf, policyWarnings, type AssetAmount } from "./review-common";
import { shortAddress, sortWarnings, usdOf, warning } from "./review-format";
import type { Label, NameLookup, PolicyCheckInput, Prices, ReviewAction, ReviewHero, ReviewModel, ReviewRow, ReviewWarning, TokenLookup } from "./review-types";

const U64_MAX = 2n ** 64n - 1n;

export interface SolanaReviewInput {
  decoded: DecodedSolanaTx;
  from: { address: string; name?: string };
  dappName: string;
  tokenOf: TokenLookup;
  prices: Prices;
  nameOf?: NameLookup;
  policy?: PolicyCheckInput | null;
  /** Base64 transaction for the raw-data disclosure. */
  raw?: string;
}

interface IxView {
  action: ReviewAction;
  warning?: ReviewWarning;
  /** What this instruction takes out of the wallet (SOL / SPL transfers from the wallet). */
  outflow?: AssetAmount;
  /** Hero amount when this is the only action (send / approve). */
  heroAmount?: Label;
}

function tokenAmount(ix: DecodedSolanaIx, tokenOf: TokenLookup): AssetAmount | null {
  if (!ix.amount) return null;
  const info = ix.mint ? tokenOf(ix.mint) : undefined;
  const decimals = ix.decimals ?? info?.decimals;
  if (decimals == null) return null;
  return { raw: BigInt(ix.amount), decimals, symbol: info?.symbol ?? (ix.mint ? shortAddress(ix.mint) : "?") };
}

function viewOf(ix: DecodedSolanaIx, index: number, i: SolanaReviewInput): IxView {
  const party = (address: string | null | undefined, prefix: "to" | "for" | "account") =>
    address ? { prefix, party: partyOf(address, i.nameOf) } : undefined;
  const program = partyOf(ix.programId, () => ix.programLabel);
  const wallet = i.from.address;
  const n = String(index + 1);
  switch (ix.type) {
    case "sol_transfer": {
      const amt: AssetAmount = { raw: BigInt(ix.amount ?? "0"), decimals: 9, symbol: "SOL" };
      return {
        action: { icon: "send", title: { key: "review.action.send", params: { amount: amountText(amt, 9) } }, party: party(ix.to, "to") },
        outflow: ix.from === wallet ? amt : undefined,
        heroAmount: { text: amountText(amt, 9) },
      };
    }
    case "spl_transfer": {
      const amt = tokenAmount(ix, i.tokenOf);
      const title: Label = amt
        ? { key: "review.action.send", params: { amount: amountText(amt, amt.decimals) } }
        : { key: "review.action.sendBaseUnits", params: { amount: ix.amount ?? "0" } };
      return {
        action: { icon: "send", title, party: party(ix.destOwner ?? ix.to, "to") },
        outflow: amt && ix.from === wallet ? amt : undefined,
        heroAmount: amt ? { text: amountText(amt, amt.decimals) } : title,
      };
    }
    case "spl_approve": {
      const amt = tokenAmount(ix, i.tokenOf);
      const raw = BigInt(ix.amount ?? "0");
      const spender = ix.delegate ? (i.nameOf?.(ix.delegate) ?? shortAddress(ix.delegate)) : "?";
      const symbol = amt?.symbol ?? (ix.mint ? shortAddress(ix.mint) : "?");
      const unlimited = raw === U64_MAX;
      const text = amt ? amountText(amt, amt.decimals) : `${raw} ${symbol}`;
      return {
        action: {
          icon: "approve", tone: "warning",
          title: unlimited ? { key: "review.action.approveUnlimited", params: { symbol } } : { key: "review.action.approve", params: { amount: text } },
          party: party(ix.delegate, "for"),
        },
        warning: unlimited ? warning("unlimitedApproval", { spender, symbol }) : warning("approval", { spender, amount: text }),
        heroAmount: unlimited ? { key: "review.unlimited", params: { symbol } } : { text },
      };
    }
    case "spl_set_authority":
      return {
        action: { icon: "authority", tone: "danger", title: { key: "review.action.setAuthority" }, party: party(ix.newAuthority, "to"), detail: ix.newAuthority ? undefined : { key: "review.action.noAuthority" } },
        warning: warning("accountControl", { index: n }),
      };
    case "spl_close_account":
      return {
        action: { icon: "close", tone: ix.highRisk ? "danger" : undefined, title: { key: "review.action.closeAccount" }, party: party(ix.to, "to") },
        warning: ix.highRisk ? warning("accountControl", { index: n }) : undefined,
      };
    case "account_control":
      return {
        action: { icon: "authority", tone: "danger", title: { key: "review.action.accountControl", params: { op: ix.op ?? "" } }, party: party(ix.account, "account") },
        warning: warning("accountControl", { index: n }),
      };
    case "ata_create": {
      const symbol = ix.mint ? (i.tokenOf(ix.mint)?.symbol ?? shortAddress(ix.mint)) : "?";
      return { action: { icon: "create", title: { key: "review.action.createAta", params: { symbol } }, party: party(ix.destOwner, "for"), detail: { key: "review.action.rentRefundable" } } };
    }
    case "memo":
      return { action: { icon: "memo", title: { key: "review.action.memo" }, detail: { text: `"${ix.memo ?? ""}"` } } };
    case "spl_other":
      return {
        action: { icon: "token", tone: ix.highRisk ? "warning" : undefined, title: { key: "review.action.tokenOp", params: { op: ix.op ?? "" } }, party: party(ix.account, "account") },
        warning: ix.highRisk ? warning("riskyAction", { index: n }) : undefined,
      };
    case "program":
      if (!ix.highRisk) return { action: { icon: "program", title: { key: "review.action.programOp", params: { op: ix.op ?? "" } } } };
      return {
        action: {
          icon: "program", tone: "warning",
          title: ix.programLabel ? { key: "review.action.callProgram", params: { name: ix.programLabel } } : { key: "review.action.unknownProgram" },
          party: { prefix: "program", party: program },
          detail: { key: "review.action.unreadable" },
        },
        warning: warning("unknownProgram", { index: n, program: ix.programLabel ?? shortAddress(ix.programId), dapp: i.dappName }),
      };
    default:
      return {
        action: { icon: "unknown", tone: "warning", title: { key: "review.action.undecoded" }, party: { prefix: "program", party: program }, detail: ix.detail ? { text: ix.detail } : undefined },
        warning: warning("unknownProgram", { index: n, program: ix.programLabel ?? shortAddress(ix.programId), dapp: i.dappName }),
      };
  }
}

function heroOf(views: IxView[], outflow: AssetAmount[], prices: Prices): ReviewHero {
  const only = views.length === 1 ? views[0] : null;
  if (only?.heroAmount && (only.action.icon === "send" || only.action.icon === "approve")) {
    const send = only.action.icon === "send";
    const p = only.action.party;
    return {
      icon: only.action.icon,
      tone: send ? "accent" : "warning",
      verb: { key: send ? "review.verb.send" : "review.verb.approve" },
      amount: only.heroAmount,
      usd: send && outflow.length === 1 ? amountUsd(outflow[0], prices) : undefined,
      counterparty: p && (p.prefix === "to" || p.prefix === "for") ? { prefix: p.prefix, party: p.party } : undefined,
    };
  }
  const usds = outflow.map((o) => amountUsd(o, prices));
  return {
    icon: "stack",
    tone: "accent",
    verb: { key: "review.verb.solanaTx" },
    amount: outflow.length
      ? { text: outflow.map((o) => `−${amountText(o, o.decimals)}`).join(" · ") }
      : { key: "review.actions", params: { count: String(views.length) } },
    usd: outflow.length && usds.every((u) => u !== undefined) ? usds.reduce<number>((s, u) => s + (u ?? 0), 0) : undefined,
  };
}

export function buildSolanaReview(i: SolanaReviewInput): ReviewModel {
  const { decoded } = i;
  const real = decoded.instructions.filter((ix) => ix.type !== "compute_budget");
  const views = real.map((ix, idx) => viewOf(ix, idx, i));
  // Same-asset outflows are summed for the hero and the total.
  const outflow = mergeAmounts(views.map((v) => v.outflow).filter((o): o is AssetAmount => !!o));
  const warnings: ReviewWarning[] = [...policyWarnings(i.policy), ...views.map((v) => v.warning).filter((w): w is ReviewWarning => !!w)];
  if (decoded.fee.exceedsCap) warnings.push(warning("feeCap", { cap: `${formatLamports(BigInt(decoded.fee.capLamports))} SOL` }));

  const fee = decoded.fee;
  const feeLamports = BigInt(fee.totalLamports);
  const priority = BigInt(fee.priorityLamports);
  const rent = BigInt(fee.rentLamports);
  const sol = (l: bigint) => `${formatLamports(l)} SOL`;
  const details: ReviewRow[] = [
    { label: { key: "review.fee.base" }, value: { text: sol(BigInt(fee.baseLamports)) } },
    ...(priority > 0n ? [{ label: { key: "review.fee.priority" }, value: { text: sol(priority) } }] : []),
    ...(fee.computeUnitLimit != null ? [{ label: { key: "review.fee.cuLimit" }, value: { text: fee.computeUnitLimit.toLocaleString("en-US") } }] : []),
    ...(BigInt(fee.computeUnitPrice) > 0n ? [{ label: { key: "review.fee.cuPrice" }, value: { key: "review.fee.microLamports", params: { price: fee.computeUnitPrice } } }] : []),
    ...(rent > 0n ? [{ label: { key: "review.fee.rent" }, value: { text: sol(rent) } }] : []),
  ];
  const rows: ReviewRow[] = [fromRow(i.from)];
  // A single send / approve is the hero: its counterparty gets the full-address row (anti address-poisoning).
  const only = views.length === 1 && views[0].heroAmount ? views[0].action.party : undefined;
  if (only && (only.prefix === "to" || only.prefix === "for")) {
    rows.push({ label: { key: only.prefix === "to" ? "send.to" : "review.spender" }, party: only.party, fullAddress: true });
  }

  return {
    hero: heroOf(views, outflow, i.prices),
    warnings: sortWarnings(warnings),
    rows,
    // A single send / approve is the hero itself; anything else lists every action.
    actions: views.length === 1 && views[0].heroAmount ? [] : views.map((v) => v.action),
    fee: {
      amount: sol(feeLamports),
      approx: true,
      usd: usdOf(formatLamports(feeLamports), "SOL", i.prices),
      inclPriority: priority > 0n,
      details,
    },
    total: buildTotal([...outflow, { raw: BigInt(fee.costLamports), decimals: 9, symbol: "SOL" }], i.prices),
    raw: i.raw,
  };
}
