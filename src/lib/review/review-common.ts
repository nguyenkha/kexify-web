// Pieces every review builder shares: policy warnings, fee and total, the "From" row.

import { formatUnits, trimDecimals, usdOf, warning } from "./review-format";
import type { PolicyCheckInput, Prices, ReviewFee, ReviewParty, ReviewRow, ReviewTotal, ReviewWarning } from "./review-types";

/** Policy pre-check → danger banners (blocked first, then risky address). */
export function policyWarnings(policy: PolicyCheckInput | null | undefined): ReviewWarning[] {
  if (!policy) return [];
  const out: ReviewWarning[] = [];
  if (policy.allowed === false) out.push(warning("policyBlocked", { leg: policy.blockedLeg ?? "" }, true));
  if (policy.fraudCheck?.flagged) out.push(warning("riskyAddress"));
  return out;
}

/** An amount in base units of one asset. */
export interface AssetAmount {
  raw: bigint;
  decimals: number;
  symbol: string;
}

export function amountText(a: AssetAmount, maxDecimals = 8): string {
  return `${trimDecimals(formatUnits(a.raw, a.decimals), maxDecimals)} ${a.symbol}`;
}

export function amountUsd(a: AssetAmount, prices: Prices): number | undefined {
  return usdOf(formatUnits(a.raw, a.decimals), a.symbol, prices);
}

/** Network fee in the native asset; `null` = still estimating. */
export function buildFee(fee: AssetAmount | null, prices: Prices, extra: Partial<ReviewFee> = {}): ReviewFee {
  if (!fee) return { loading: true, ...extra };
  return { amount: amountText(fee), usd: amountUsd(fee, prices), ...extra };
}

/**
 * Everything that leaves the wallet plus the fee. Same-asset parts are summed; the fiat total is
 * given only when every part is priced (never a partial "$0.00").
 */
export function buildTotal(parts: AssetAmount[], prices: Prices): ReviewTotal {
  const merged = mergeAmounts(parts);
  const texts = merged.map((m) => amountText(m));
  const usds = merged.map((m) => amountUsd(m, prices));
  const allPriced = merged.length > 0 && usds.every((u) => u !== undefined);
  return {
    usd: allPriced ? usds.reduce<number>((s, u) => s + (u ?? 0), 0) : undefined,
    native: merged.length === 1 ? texts[0] : undefined,
    parts: texts,
  };
}

/** Sum same-asset amounts, dropping zero ones; keeps first-seen order. */
export function mergeAmounts(parts: AssetAmount[]): AssetAmount[] {
  const merged: AssetAmount[] = [];
  for (const p of parts) {
    if (p.raw <= 0n) continue;
    const same = merged.find((m) => m.symbol === p.symbol && m.decimals === p.decimals);
    if (same) same.raw += p.raw;
    else merged.push({ ...p });
  }
  return merged;
}

export function fromRow(from: ReviewParty): ReviewRow {
  return { label: { key: "send.from" }, party: from };
}

export function partyOf(address: string, nameOf?: (a: string) => string | undefined): ReviewParty {
  const name = nameOf?.(address);
  return name ? { address, name } : { address };
}
