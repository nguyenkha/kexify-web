// Formatting helpers shared by the review builders and both UIs.

import { keccak_256 } from "@noble/hashes/sha3";
import type { Prices, ReviewWarning, WarningCode } from "./review-types";

/** Allowances at or above 2^128 are treated as unlimited (dApps use 2^256-1, 2^160-1, ...). */
export const UNLIMITED_THRESHOLD = 2n ** 128n;

/** Base units to a decimal string without trailing zeros. */
export function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  if (decimals <= 0) return (neg ? "-" : "") + abs.toString();
  const s = abs.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + (frac ? `${int}.${frac}` : int);
}

/** Round a decimal string to at most `max` fraction digits (display only). */
export function trimDecimals(value: string, max = 6): string {
  const [int, frac = ""] = value.split(".");
  if (!frac || frac.length <= max) return value;
  const cut = frac.slice(0, max).replace(/0+$/, "");
  // Tiny non-zero values keep their first significant digits instead of rounding to 0.
  if (!cut && int.replace("-", "") === "0") {
    const sig = frac.match(/^0*[1-9]\d{0,1}/)?.[0];
    return sig ? `${int}.${sig}` : value;
  }
  return cut ? `${int}.${cut}` : int;
}

/** USD value of `amount` (decimal string) of `symbol`, or undefined when unpriced. */
export function usdOf(amount: string, symbol: string, prices: Prices): number | undefined {
  const p = prices[symbol];
  const n = Number(amount);
  if (!p || !Number.isFinite(n)) return undefined;
  return n * p;
}

/** EIP-55 checksum casing for a 0x address (calldata words are lower-case). Others unchanged. */
export function checksumEvmAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return address;
  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0xf;
    out += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/** First 6 … last 4, the short form used everywhere except the main counterparty. */
export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Full address in groups of 4 for the main counterparty. `0x` stays its own group so the
 * hex groups line up; the first and last group are the ones the UI emphasises.
 */
export function groupAddress(address: string): string[] {
  const prefix = address.startsWith("0x") ? "0x" : "";
  const body = address.slice(prefix.length);
  const groups = body.match(/.{1,4}/g) ?? [];
  return prefix ? [prefix, ...groups] : groups;
}

const WARNING_ORDER: WarningCode[] = [
  "policyBlocked",
  "riskyAddress",
  "unreadable",
  "signHash",
  "accountControl",
  "nftApprovalForAll",
  "riskyAction",
  "unlimitedApproval",
  "approval",
  "unknownProgram",
  "firstTimeRecipient",
  "mayFail",
  "wrongNetwork",
  "feeCap",
];

/** Stable sort by the spec order, one entry per code. */
export function sortWarnings(list: ReviewWarning[]): ReviewWarning[] {
  const seen = new Set<WarningCode>();
  return list
    .filter((w) => (seen.has(w.code) ? false : (seen.add(w.code), true)))
    .sort((a, b) => WARNING_ORDER.indexOf(a.code) - WARNING_ORDER.indexOf(b.code));
}

export function warning(code: WarningCode, params: Record<string, string> = {}, blocks = false): ReviewWarning {
  const danger: WarningCode[] = ["policyBlocked", "riskyAddress", "unreadable", "signHash", "accountControl", "nftApprovalForAll"];
  return { code, tone: danger.includes(code) ? "danger" : "warning", blocks, params };
}
