import { useEffect, useRef, useState } from "react";
import { fetchReceiptOnce, type ReceiptResult } from "../../lib/chains/evmTx";
import { evmReceiptRpcUrls } from "../../lib/chains/evm-read-rpc-fallbacks";
import type { Chain } from "../../shared/types";

export const PENDING_POLL_INTERVAL_MS = 10_000;
export const PENDING_POLL_MAX_ATTEMPTS = 60; // ~10 min

/**
 * Background receipt polling for a broadcast EVM tx left "pending" (RPC errors or slow chain).
 * Calls onResolved when a receipt arrives; returns gaveUp=true once the bound is reached.
 * Stops on unmount / dependency change. RPC errors never resolve the tx as failed.
 */
export function usePendingEvmReceipt(
  enabled: boolean,
  chain: Pick<Chain, "rpcUrl" | "evmChainId"> | null | undefined,
  txHash: string | null | undefined,
  onResolved: (r: ReceiptResult) => void,
  intervalMs = PENDING_POLL_INTERVAL_MS,
  maxAttempts = PENDING_POLL_MAX_ATTEMPTS,
): boolean {
  const [gaveUpFor, setGaveUpFor] = useState<string | null>(null);
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  const rpcUrl = chain?.rpcUrl;
  const evmChainId = chain?.evmChainId;

  useEffect(() => {
    if (!enabled || !txHash || !rpcUrl) return;
    const urls = evmReceiptRpcUrls({ rpcUrl, evmChainId: evmChainId ?? null });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let idx = 0;

    const tick = async () => {
      attempt++;
      try {
        const res = await fetchReceiptOnce(urls, txHash, idx);
        idx = res.rpcIdx;
        if (cancelled) return;
        if (res.receipt) { onResolvedRef.current(res.receipt); return; }
      } catch {
        // all RPCs errored: not a tx failure, try again next tick
      }
      if (cancelled) return;
      if (attempt >= maxAttempts) { setGaveUpFor(txHash); return; }
      timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, intervalMs);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [enabled, txHash, rpcUrl, evmChainId, intervalMs, maxAttempts]);

  return !!txHash && gaveUpFor === txHash;
}
