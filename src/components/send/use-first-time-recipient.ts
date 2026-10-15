// First-time recipient check for the Review warning (UX spec: send.md step 3, mismatch #19).
// Known = saved in the address book or recent recipients for this chain, or an earlier outgoing
// transaction to it. Advisory only: it never blocks the send.

import { useEffect, useState } from "react";
import { getAddressSuggestions } from "../../lib/addressBook";
import { fetchTransactions } from "../../lib/transactions";
import type { Chain, Asset } from "../../lib/api";

const HISTORY_TIMEOUT_MS = 4000;

/** Compare addresses without case or a `scheme:` prefix (bitcoincash:, etc.). */
function norm(addr: string): string {
  return addr.trim().toLowerCase().replace(/^[a-z]+:/, "");
}

export function isKnownRecipient(to: string, chainType: string): boolean {
  const target = norm(to);
  return getAddressSuggestions(chainType).some((e) => norm(e.address) === target);
}

/** true = first time, false = known, null = still checking (or no recipient yet). */
export function useFirstTimeRecipient(
  active: boolean,
  to: string,
  from: string,
  chain: Chain,
  asset: Asset,
): boolean | null {
  const [result, setResult] = useState<{ key: string; firstTime: boolean } | null>(null);
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
      const sentBefore = !!page?.transactions.some((tx) => tx.direction === "out" && norm(tx.to) === target);
      // History unavailable: show the warning (it is advisory, erring on the careful side).
      setResult({ key, firstTime: !sentBefore });
    });
    return () => { cancelled = true; };
  }, [active, known, key, to, from, chain, asset]);

  if (!active || !to) return null;
  if (known) return false;
  return result?.key === key ? result.firstTime : null;
}
