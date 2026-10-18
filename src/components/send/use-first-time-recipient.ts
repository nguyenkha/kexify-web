// Recipient checks for the Review warnings (UX spec: send.md step 3, mismatch #19).
// Known = saved in the address book or recent recipients for this chain, an earlier outgoing transaction to it, or
// the wallet's own address. A destination that only looks like a known one (same ends, other middle) is address
// poisoning: lib/review/lookalike-address. Advisory only: neither check blocks the send.

import { useEffect, useState } from "react";
import { getAddressSuggestions } from "../../lib/addressBook";
import { fetchTransactions } from "../../lib/transactions";
import type { Chain, Asset } from "../../lib/api";
import type { ReviewParty } from "../../lib/review";

const HISTORY_TIMEOUT_MS = 4000;

/** Compare addresses without case or a `scheme:` prefix (bitcoincash:, etc.). */
function norm(addr: string): string {
  return addr.trim().toLowerCase().replace(/^[a-z]+:/, "");
}

export function isKnownRecipient(to: string, chainType: string): boolean {
  const target = norm(to);
  return getAddressSuggestions(chainType).some((e) => norm(e.address) === target);
}

export interface RecipientCheck {
  /** true = first time, false = known, null = still checking (or no recipient yet). */
  firstTime: boolean | null;
  /** Addresses to compare the destination with for the lookalike warning. */
  known: ReviewParty[];
}

export function useFirstTimeRecipient(
  active: boolean,
  to: string,
  from: string,
  chain: Chain,
  asset: Asset,
): RecipientCheck {
  const [result, setResult] = useState<{ key: string; firstTime: boolean; sentTo: string[] } | null>(null);
  const key = `${chain.id}:${asset.symbol}:${to}`;
  // Saved / recent recipients are local: no need to wait for history.
  const known = active && !!to && isKnownRecipient(to, chain.type);

  useEffect(() => {
    if (!active || !to || known) return;
    let cancelled = false;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), HISTORY_TIMEOUT_MS));
    const history = fetchTransactions(from, chain, asset, 1).catch(() => null);
    Promise.race([history, timeout]).then((page) => {
      if (cancelled) return;
      const target = norm(to);
      // Outgoing only: a poisoning address reaches the history by sending dust, so incoming senders are not "known".
      const sentTo = (page?.transactions ?? []).filter((tx) => tx.direction === "out" && tx.to).map((tx) => tx.to);
      const sentBefore = sentTo.some((a) => norm(a) === target);
      // History unavailable: show the warning (it is advisory, erring on the careful side).
      setResult({ key, firstTime: !sentBefore, sentTo });
    });
    return () => { cancelled = true; };
  }, [active, known, key, to, from, chain, asset]);

  if (!active || !to) return { firstTime: null, known: [] };
  if (known) return { firstTime: false, known: [] };
  const book: ReviewParty[] = getAddressSuggestions(chain.type).map((e) => ({ address: e.address, ...("label" in e && e.label ? { name: e.label } : {}) }));
  const own: ReviewParty = { address: from };
  if (result?.key !== key) return { firstTime: null, known: [...book, own] };
  return { firstTime: result.firstTime, known: [...book, own, ...result.sentTo.map((address) => ({ address }))] };
}
