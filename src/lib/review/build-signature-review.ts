// Signature requests → review model: EIP-712 typed data (Permit, Permit2, others) and message
// signatures (personal_sign, eth_sign, solana_signMessage, tron_signMessage).

import { amountText, amountUsd, fromRow, partyOf, policyWarnings } from "./review-common";
import { shortAddress, sortWarnings, UNLIMITED_THRESHOLD, warning } from "./review-format";
import { canonicalFormat, type TypeDefs } from "./typed-data-known-formats";
import type { NameLookup, PolicyCheckInput, Prices, ReviewAction, ReviewModel, ReviewRow, ReviewWarning, TokenLookup } from "./review-types";

interface TypedData {
  primaryType?: string;
  types?: Record<string, Array<{ name: string; type: string }>>;
  domain?: { name?: string; chainId?: number | string; verifyingContract?: string };
  message?: Record<string, unknown>;
}

export interface TypedDataReviewInput {
  /** The request's typed data (JSON string or object). */
  typedData: string | TypedData;
  from: { address: string; name?: string };
  /** EVM chain id the request was sent on (for the wrong-network warning). */
  chainId?: number;
  tokenOf: TokenLookup;
  prices: Prices;
  nameOf?: NameLookup;
  policy?: PolicyCheckInput | null;
}

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? String(v) : "");
const big = (v: unknown): bigint | null => {
  try {
    const s = str(v);
    return s === "" ? null : BigInt(s);
  } catch {
    return null;
  }
};
/** Deadlines in ms or s → seconds. */
const toSeconds = (v: unknown): number | undefined => {
  const n = Number(str(v));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n > 1e12 ? Math.floor(n / 1000) : n;
};

interface Allowance {
  token: string;
  amount: bigint;
  /** ERC-721 permit: one token id, not an amount. */
  nftId?: string;
  expires?: number;
}

interface TypedGrant {
  spender: string;
  allowances: Allowance[];
  deadline?: number;
  /** DaiPermit(allowed=false) / PermitForAll(approved=false): an explicit revoke. */
  revoke?: boolean;
  /** PermitForAll(approved=true): every NFT of the collection. */
  nftAll?: boolean;
}

const UINT_MAX = 2n ** 256n - 1n;

/** The approvals a known format grants (canonicalFormat: exact typehash match, as the server). */
function typedGrant(td: TypedData): TypedGrant | null {
  const m = td.message ?? {};
  const token = td.domain?.verifyingContract ?? "";
  switch (canonicalFormat(td.primaryType ?? "", td.types as TypeDefs)) {
    case "Permit": {
      const amount = big(m.value);
      return amount == null || !token ? null : { spender: str(m.spender), allowances: [{ token, amount, expires: toSeconds(m.deadline) }] };
    }
    case "DaiPermit": {
      const allowed = m.allowed === true || m.allowed === "true";
      return token ? { spender: str(m.spender), allowances: [{ token, amount: allowed ? UINT_MAX : 0n, expires: toSeconds(m.expiry) }], revoke: !allowed } : null;
    }
    case "Erc721Permit":
      return token ? { spender: str(m.spender), allowances: [{ token, amount: 1n, nftId: str(m.tokenId), expires: toSeconds(m.deadline) }] } : null;
    case "PermitForAll": {
      const approved = m.approved === true || m.approved === "true";
      return token ? { spender: str(m.operator), allowances: [{ token, amount: approved ? UINT_MAX : 0n, expires: toSeconds(m.deadline) }], revoke: !approved, nftAll: approved } : null;
    }
    case "PermitSingle":
    case "PermitBatch":
    case "PermitTransferFrom":
    case "PermitBatchTransferFrom": {
      const transfer = td.primaryType!.includes("TransferFrom");
      const list = transfer ? m.permitted : m.details;
      const details = Array.isArray(list) ? list : [list];
      const allowances: Allowance[] = [];
      for (const d of details as Array<Record<string, unknown> | undefined>) {
        const amount = big(d?.amount);
        if (amount == null || !str(d?.token)) return null;
        allowances.push({ token: str(d?.token), amount, expires: transfer ? undefined : toSeconds(d?.expiration) });
      }
      const deadline = toSeconds(transfer ? m.deadline : m.sigDeadline);
      return allowances.length ? { spender: str(m.spender), allowances, deadline } : null;
    }
    default:
      return null;
  }
}

/** EIP-3009 transfer / receive with authorization: a signed token transfer. */
function typedTransfer(td: TypedData): { to: string; token: string; amount: bigint; validBefore?: number } | null {
  if (canonicalFormat(td.primaryType ?? "", td.types as TypeDefs) !== "Eip3009") return null;
  const m = td.message ?? {};
  const amount = big(m.value);
  const token = td.domain?.verifyingContract;
  return amount == null || !token || !str(m.to) ? null : { to: str(m.to), token, amount, validBefore: toSeconds(m.validBefore) };
}

export function buildTypedDataReview(i: TypedDataReviewInput): ReviewModel {
  let td: TypedData;
  try {
    td = typeof i.typedData === "string" ? JSON.parse(i.typedData) : i.typedData;
  } catch {
    td = {};
  }
  const raw = JSON.stringify(td.message ?? td, null, 2);
  const warnings: ReviewWarning[] = [...policyWarnings(i.policy)];
  const rows: ReviewRow[] = [fromRow(i.from)];
  const contract = td.domain?.verifyingContract;
  const domainChain = td.domain?.chainId != null ? Number(td.domain.chainId) : undefined;
  if (i.chainId && domainChain && domainChain !== i.chainId) warnings.push(warning("wrongNetwork"));

  const sent = typedTransfer(td);
  if (sent) {
    const info = i.tokenOf(sent.token);
    const amt = info ? { raw: sent.amount, decimals: info.decimals, symbol: info.symbol } : null;
    const party = partyOf(sent.to, i.nameOf);
    rows.push({ label: { key: "send.to" }, party, fullAddress: true });
    rows.push({ label: { key: "review.token" }, party: partyOf(sent.token, () => info?.symbol) });
    if (sent.validBefore) rows.push({ label: { key: "review.expires" }, date: sent.validBefore });
    return {
      hero: {
        icon: "send", tone: "accent", verb: { key: "review.verb.send" },
        amount: amt ? { text: amountText(amt) } : { key: "review.baseUnits", params: { amount: sent.amount.toString(), symbol: shortAddress(sent.token) } },
        usd: amt ? amountUsd(amt, i.prices) : undefined,
        counterparty: { prefix: "to", party },
      },
      warnings: sortWarnings(warnings), rows, actions: [], noFee: "signature", raw, permitFixed: true,
    };
  }

  const permit = typedGrant(td);
  if (permit && permit.spender) {
    const spender = partyOf(permit.spender, i.nameOf);
    const spenderName = spender.name ?? shortAddress(permit.spender);
    const legs = permit.allowances.map((a) => {
      const info = i.tokenOf(a.token);
      const symbol = info?.symbol ?? shortAddress(a.token);
      const unlimited = !a.nftId && a.amount >= UNLIMITED_THRESHOLD;
      const amt = info && !a.nftId ? { raw: a.amount, decimals: info.decimals, symbol } : null;
      const text = a.nftId != null ? `${symbol} #${a.nftId}` : unlimited ? null : amt ? amountText(amt) : `${a.amount} ${symbol}`;
      return { ...a, symbol, unlimited, text, usd: amt && !unlimited ? amountUsd(amt, i.prices) : undefined };
    });
    for (const l of legs) {
      if (permit.revoke) continue;
      // The server signs no unlimited fungible permit (Permit2 / EIP-2612 / DAI): blocking, the
      // amount is in the signature so it cannot be capped here. A collection-wide NFT grant is allowed.
      if (permit.nftAll) warnings.push(warning("nftApprovalForAll", { spender: spenderName, collection: l.symbol }));
      else warnings.push(l.unlimited
        ? warning("unlimitedApproval", { spender: spenderName, symbol: l.symbol }, true)
        : warning("approval", { spender: spenderName, amount: l.text ?? "" }));
    }
    const one = legs.length === 1 ? legs[0] : null;
    const actions: ReviewAction[] = one ? [] : legs.map((l): ReviewAction => ({
      icon: "approve",
      tone: l.unlimited ? "warning" : undefined,
      title: l.unlimited ? { key: "review.action.approveUnlimited", params: { symbol: l.symbol } } : { key: "review.action.approve", params: { amount: l.text ?? "" } },
      party: { prefix: "for", party: spender },
    }));
    rows.push({ label: { key: "review.spender" }, party: spender, fullAddress: true });
    if (one) rows.push({ label: { key: "review.token" }, party: partyOf(one.token, () => one.symbol) });
    const expires = one?.expires ?? permit.deadline;
    if (expires) rows.push({ label: { key: "review.expires" }, date: expires });
    if (contract) rows.push({ label: { key: "review.signedFor" }, party: partyOf(contract, i.nameOf) });
    return {
      hero: {
        icon: "approve", tone: permit.revoke ? "accent" : permit.nftAll ? "danger" : "warning", verb: { key: permit.revoke ? "review.verb.revoke" : "review.verb.approve" },
        amount: permit.revoke ? { text: one?.symbol ?? "" } : permit.nftAll && one ? { key: "review.nftAll", params: { collection: one.symbol } } : one ? (one.unlimited ? { key: "review.unlimited", params: { symbol: one.symbol } } : { text: one.text ?? "" }) : { key: "review.tokenCount", params: { count: String(legs.length) } },
        usd: one?.usd,
        counterparty: { prefix: "for", party: spender },
      },
      warnings: sortWarnings(warnings),
      rows,
      actions,
      noFee: "signature",
      raw,
      ...(permit.nftAll ? { extraConfirm: "nftApprovalForAll" as const } : {}),
      permitFixed: true,
    };
  }

  // Any other typed data: name it by its type and show the whole message, nothing hidden.
  if (contract) rows.push({ label: { key: "review.contract" }, party: partyOf(contract, i.nameOf) });
  return {
    hero: {
      icon: "sign", tone: "accent",
      verb: { key: "review.verb.signTyped", params: { type: td.primaryType ?? "data" } },
      amount: td.domain?.name ? { text: td.domain.name } : undefined,
    },
    warnings: sortWarnings(warnings),
    rows,
    actions: [],
    noFee: "signature",
    message: raw,
  };
}

export interface MessageReviewInput {
  kind: "personal" | "hash" | "solana" | "tron";
  /** Decoded text (personal / solana / tron) or the 32-byte hash (eth_sign). */
  text: string;
  from: { address: string; name?: string };
}

/** Sign-in-with-Ethereum / Solana first line: "<domain> wants you to sign in with your … account:". */
function signInDomain(text: string): string | null {
  const m = /^(\S+) wants you to sign in with your \w+ account:/.exec(text);
  return m ? m[1] : null;
}

export function buildMessageReview(i: MessageReviewInput): ReviewModel {
  const rows = [fromRow(i.from)];
  if (i.kind === "hash") {
    return {
      hero: { icon: "warning", tone: "danger", verb: { key: "review.verb.signHash" }, amount: { text: shortAddress(i.text) } },
      warnings: [warning("signHash")],
      rows,
      actions: [],
      noFee: "message",
      message: i.text,
    };
  }
  const domain = signInDomain(i.text);
  const firstLine = i.text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return {
    hero: {
      icon: "sign", tone: "accent", verb: { key: "review.verb.signMessage" },
      amount: domain ? { key: "review.signInTo", params: { domain } } : { text: firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine },
      noFundsMove: true,
    },
    warnings: [],
    rows,
    actions: [],
    noFee: "message",
    message: i.text,
  };
}
