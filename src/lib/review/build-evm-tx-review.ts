// eth_sendTransaction → review model: native send, ERC-20 transfer / approve, or contract call.

import { amountLabel, amountText, amountUsd, buildFee, buildTotal, fromRow, partyOf, policyWarnings, type AssetAmount } from "./review-common";
import { evmLegs } from "./evm-calldata-legs";
import { checksumEvmAddress, shortAddress, sortWarnings, UNLIMITED_THRESHOLD, warning } from "./review-format";
import { withEvmApproveAmount } from "./allowance-edit";
import type { NameLookup, PolicyCheckInput, Prices, ReviewModel, ReviewRow, ReviewWarning, TokenInfo, TokenLookup } from "./review-types";

const MAX_UINT256 = 2n ** 256n - 1n;

const APPROVE = "095ea7b3";

export type EvmCall =
  | { kind: "native" }
  | { kind: "transfer"; to: string; amount: bigint | "ALL"; token: string }
  | { kind: "approve"; spender: string; amount: bigint | "ALL"; token: string; nft: boolean; plain: boolean }
  | { kind: "contract" };

/**
 * What the calldata does, read by the API policy's own decoder (evmLegs): token transfers (transfer, transferFrom
 * from self, ERC-777 / 677 sends, NFT transfers), approvals (approve, increaseAllowance, setApprovalForAll,
 * authorizeOperator, permit calldata, Permit2 approve / permit) — so the review names exactly the leg the policy
 * judges. Anything else is a contract call. `plain` = a plain ERC-20 approve whose amount the user may edit.
 */
export function decodeEvmCall(data: string | undefined, from = "", to = ""): EvmCall {
  if (!data || data === "0x") return { kind: "native" };
  const hex = data.replace(/^0x/, "").toLowerCase();
  const leg = evmLegs(from, to, 0n, hex).find((l) => l.kind !== "transfer" || l.asset.contract !== null);
  if (leg?.kind === "transfer") return { kind: "transfer", to: checksumEvmAddress(leg.to), amount: leg.amount, token: leg.asset.contract ?? to };
  if (leg?.kind === "approval") {
    return {
      kind: "approve", spender: checksumEvmAddress(leg.spender), amount: leg.amount, token: checksumEvmAddress(leg.asset.contract ?? to),
      nft: leg.standard === "erc721_all", plain: hex.startsWith(APPROVE) && hex.length === 136,
    };
  }
  return { kind: "contract" };
}

export interface EvmTxReviewInput {
  tx: { to?: string; value?: string; data?: string };
  from: { address: string; name?: string };
  nativeSymbol: string;
  /** Metadata of `tx.to` when it is a known token contract. */
  token?: TokenInfo;
  /** Metadata of any token (the one a Permit2 approve names). */
  tokenOf?: TokenLookup;
  /** Approve: the user's current balance of the token, already formatted with symbol. */
  tokenBalance?: string;
  /** Allowance the user edited in the approve editor (base units). */
  approveOverride?: bigint | null;
  /** Approve: the user's current balance of the token in base units (editor option). */
  tokenBalanceRaw?: bigint;
  /** Estimated network fee in wei; null while estimating. */
  feeWei: bigint | null;
  prices: Prices;
  nameOf?: NameLookup;
  policy?: PolicyCheckInput | null;
  firstTimeRecipient?: boolean;
  mayFail?: boolean;
}

export function buildEvmTxReview(i: EvmTxReviewInput): ReviewModel {
  const to = i.tx.to ?? "";
  const value = i.tx.value ? BigInt(i.tx.value) : 0n;
  const native: AssetAmount = { raw: value, decimals: 18, symbol: i.nativeSymbol };
  const feeAmt: AssetAmount | null = i.feeWei != null ? { raw: i.feeWei, decimals: 18, symbol: i.nativeSymbol } : null;
  const call = decodeEvmCall(i.tx.data, i.from.address, to);
  const warnings: ReviewWarning[] = [...policyWarnings(i.policy)];
  const rows: ReviewRow[] = [fromRow(i.from)];
  const contractParty = partyOf(to, (a) => i.nameOf?.(a) ?? i.token?.symbol);
  const outflow: AssetAmount[] = [native];
  let model: Pick<ReviewModel, "hero">;
  let allowance: ReviewModel["allowance"];
  // Metadata of the token the leg moves / approves (Permit2 approve names a token other than `to`).
  const tokenInfo = (addr: string): TokenInfo | undefined =>
    i.tokenOf?.(addr) ?? (addr.toLowerCase() === to.toLowerCase() ? i.token : undefined);

  if (call.kind === "native") {
    const party = partyOf(to, i.nameOf);
    model = {
      hero: { icon: "send", tone: "accent", verb: { key: "review.verb.send" }, amount: amountLabel(native), usd: amountUsd(native, i.prices), counterparty: { prefix: "to", party } },
    };
    rows.push({ label: { key: "send.to" }, party, fullAddress: true });
    if (i.firstTimeRecipient) warnings.push(warning("firstTimeRecipient"));
  } else if (call.kind === "transfer") {
    const info = tokenInfo(call.token);
    const tokenParty = partyOf(call.token, (a) => i.nameOf?.(a) ?? info?.symbol);
    const amt: AssetAmount | null = info && call.amount !== "ALL" ? { raw: call.amount, decimals: info.decimals, symbol: info.symbol } : null;
    const party = partyOf(call.to, i.nameOf);
    const label = info?.symbol ?? shortAddress(call.token);
    model = {
      hero: {
        icon: "send", tone: "accent", verb: { key: "review.verb.send" },
        // Unknown token: base units (decimals unknown); NFT / multi-token: the collection.
        amount: amt ? amountLabel(amt) : call.amount === "ALL" ? { text: label } : { key: "review.baseUnits", params: { amount: call.amount.toString(), symbol: label } },
        usd: amt ? amountUsd(amt, i.prices) : undefined,
        counterparty: { prefix: "to", party },
      },
    };
    rows.push({ label: { key: "send.to" }, party, fullAddress: true });
    rows.push({ label: { key: "review.token" }, party: tokenParty });
    if (amt) outflow.push(amt);
    if (i.firstTimeRecipient) warnings.push(warning("firstTimeRecipient"));
  } else if (call.kind === "approve") {
    const info = call.nft ? undefined : tokenInfo(call.token);
    const editable = call.plain && !!info;
    const requested = call.amount === "ALL" ? MAX_UINT256 : call.amount;
    const amount = editable ? (i.approveOverride ?? requested) : requested;
    const editedSub = editable && amount !== requested ? editedLabel(requested, info!) : undefined;
    const spender = partyOf(call.spender, i.nameOf);
    const symbol = info?.symbol ?? (i.nameOf?.(call.token) ?? shortAddress(call.token));
    const spenderName = spender.name ?? shortAddress(call.spender);
    const unlimited = call.amount === "ALL" && amount === requested ? true : amount >= UNLIMITED_THRESHOLD;
    const amt: AssetAmount | null = info ? { raw: amount, decimals: info.decimals, symbol } : null;
    // approve(x, 0) is a revoke only on a known fungible token; on an unknown (maybe ERC-721) contract the same
    // bytes approve NFT id 0 to x (api evaluate-intent.ts), so it stays an approval.
    if (call.nft) {
      // setApprovalForAll(true): every NFT of the collection, allowed per action with a red warning
      // and a second confirm (the server prices nothing here; revoke is a plain contract call).
      warnings.push(warning("nftApprovalForAll", { spender: spenderName, collection: symbol }));
      model = { hero: { icon: "approve", tone: "danger", verb: { key: "review.verb.approve" }, amount: { key: "review.nftAll", params: { collection: symbol } }, counterparty: { prefix: "for", party: spender } } };
    } else if (amount === 0n && info) {
      model = { hero: { icon: "approve", tone: "accent", verb: { key: "review.verb.revoke" }, amount: { text: symbol }, sub: editedSub, counterparty: { prefix: "for", party: spender } } };
    } else if (unlimited) {
      warnings.push(warning("unlimitedApproval", { spender: spenderName, symbol }));
      model = {
        hero: {
          icon: "approve", tone: "warning", verb: { key: "review.verb.approve" },
          amount: { key: "review.unlimited", params: { symbol } },
          sub: i.tokenBalance ? { key: "review.balanceAtRisk", params: { amount: i.tokenBalance } } : undefined,
          counterparty: { prefix: "for", party: spender },
        },
      };
    } else {
      const text = amt ? amountText(amt) : `${amount} ${symbol}`;
      warnings.push(warning("approval", { spender: spenderName, amount: text }));
      model = {
        hero: { icon: "approve", tone: "warning", verb: { key: "review.verb.approve" }, amount: amt ? { text, amount: true } : { text }, usd: amt ? amountUsd(amt, i.prices) : undefined, sub: editedSub, counterparty: { prefix: "for", party: spender } },
      };
    }
    rows.push({ label: { key: "review.spender" }, party: spender, fullAddress: true });
    rows.push({ label: { key: "review.token" }, party: partyOf(call.token, (a) => i.nameOf?.(a) ?? info?.symbol) });
    if (call.token.toLowerCase() !== to.toLowerCase()) rows.push({ label: { key: "review.contract" }, party: contractParty });
    if (editable) allowance = allowanceOf(requested, amount, info!, i.tokenBalanceRaw);
  } else {
    // Contract call: the contract is what the user talks to.
    model = {
      hero: {
        icon: "contract", tone: "accent", verb: { key: "review.verb.contract" },
        amount: value > 0n ? amountLabel(native) : { key: "review.noValue", params: { symbol: i.nativeSymbol } },
        usd: value > 0n ? amountUsd(native, i.prices) : undefined,
        counterparty: { prefix: "to", party: contractParty },
      },
    };
    rows.push({ label: { key: "review.contract" }, party: contractParty, fullAddress: true });
  }

  if (call.kind !== "native" && value > 0n && model.hero.icon !== "contract") {
    rows.push({ label: { key: "review.alsoSends" }, value: amountLabel(native) });
  }
  if (i.mayFail) warnings.push(warning("mayFail"));

  return {
    ...model,
    warnings: sortWarnings(warnings),
    rows,
    actions: [],
    fee: buildFee(feeAmt, i.prices),
    total: buildTotal(feeAmt ? [...outflow, feeAmt] : outflow, i.prices),
    // The bytes as they will be signed (an edited cap is re-encoded).
    raw: i.tx.data && i.tx.data !== "0x" ? (allowance?.edited ? withEvmApproveAmount(i.tx.data, BigInt(allowance.current)) : i.tx.data) : undefined,
    allowance,
    ...(call.kind === "approve" && call.nft ? { extraConfirm: "nftApprovalForAll" as const } : {}),
  };
}

/** "Edited · the app asked for 500 USDC" / "… for unlimited" under an edited cap. */
export function editedLabel(requested: bigint, token: TokenInfo): ReviewModel["hero"]["sub"] {
  return requested >= UNLIMITED_THRESHOLD
    ? { key: "review.editedFromUnlimited" }
    : { key: "review.editedFrom", params: { amount: amountText({ raw: requested, decimals: token.decimals, symbol: token.symbol }) } };
}

/** Editor state for an editable approval (review-and-sign.md "Spending cap"). */
export function allowanceOf(requested: bigint, current: bigint, token: TokenInfo, balance?: bigint): NonNullable<ReviewModel["allowance"]> {
  return {
    requested: requested.toString(), current: current.toString(), decimals: token.decimals, symbol: token.symbol,
    balance: balance?.toString(), edited: current !== requested,
  };
}
