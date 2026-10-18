// Address poisoning check for the send review: an attacker sends dust from an address whose first and last
// characters match one the user knows, hoping it is copied from history. A destination that matches a known
// address (address book, recent recipients, earlier counterparties, the user's own addresses) on both ends but
// differs in the middle gets a strong warning. Shared by web and iOS (JSC bundle); advisory, never blocks.

import type { ReviewParty } from "./review-types";

/** Characters that must match at each end (what wallets show in a shortened address). */
export const LOOKALIKE_EDGE = 4;

/**
 * Comparable body of an address: no case, no `scheme:` (bitcoincash:), and no part every address of the chain
 * shares (0x, bech32 `bc1q` / `ltc1q` / `addr1q` …), so the edge match counts only characters an attacker must grind.
 */
export function addressBody(addr: string): string {
  return addr
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:/, "")
    .replace(/^0x/, "")
    .replace(/^(bc|tb|bcrt|ltc|tltc|rltc|addr|addr_test)1[qpzxv]?/, "");
}

/** The known address `to` imitates, or null (no match, an exact match, or too short to judge). */
export function findLookalike(to: string, known: ReviewParty[]): ReviewParty | null {
  const target = addressBody(to);
  if (target.length < LOOKALIKE_EDGE * 2 + 2) return null;
  // An exact match anywhere means the destination itself is known.
  if (known.some((k) => addressBody(k.address) === target)) return null;
  const head = target.slice(0, LOOKALIKE_EDGE);
  const tail = target.slice(-LOOKALIKE_EDGE);
  return known.find((k) => {
    const body = addressBody(k.address);
    return body.length === target.length && body.startsWith(head) && body.endsWith(tail);
  }) ?? null;
}
