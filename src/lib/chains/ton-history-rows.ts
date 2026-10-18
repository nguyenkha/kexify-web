// toncenter history rows -> Transactions, shared by the public read (tonAdapter.ts) and the server chain proxy
// fallback (chain-proxy-ton.ts), so both show the same list.

import type { Transaction } from "../../shared/types";
import { base64ToHex } from "../../shared/utils";

/** Minimum value to display (filter dust spam): 1000 nanoTON = 0.000001 TON */
const DUST_THRESHOLD = 1000n;

export function formatTonUnits(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const str = raw.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  const fmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${fmt}.${fracPart}` : fmt;
}

export interface TonMsg { source: string; destination: string; value: string; bounced?: boolean }
export interface TonTxRow { transaction_id: { hash: string }; utime: number; in_msg?: TonMsg | null; out_msgs?: TonMsg[] }

type AssetLike = { decimals: number; symbol: string };

/** v2 getTransactions rows: one row per outgoing message above dust, else the incoming message (not bounced). */
export function tonNativeTransactions(rows: TonTxRow[], asset: AssetLike): Transaction[] {
  const txs: Transaction[] = [];
  for (const tx of rows) {
    const hash = base64ToHex(tx.transaction_id?.hash);
    const hasOutgoing = tx.out_msgs?.some((m) => BigInt(m.value || "0") > DUST_THRESHOLD);
    for (const msg of tx.out_msgs ?? []) {
      const val = BigInt(msg.value || "0");
      if (val > DUST_THRESHOLD) {
        txs.push({
          hash, from: msg.source, to: msg.destination, value: msg.value, formatted: formatTonUnits(val, asset.decimals),
          symbol: asset.symbol, timestamp: tx.utime, direction: "out", confirmed: true,
        });
      }
    }
    // Incoming: in_msg with value > threshold, skip bounced and excess returns
    if (tx.in_msg?.source && !tx.in_msg.bounced && !hasOutgoing) {
      const val = BigInt(tx.in_msg.value || "0");
      if (val > DUST_THRESHOLD) {
        txs.push({
          hash, from: tx.in_msg.source, to: tx.in_msg.destination, value: tx.in_msg.value, formatted: formatTonUnits(val, asset.decimals),
          symbol: asset.symbol, timestamp: tx.utime, direction: "in", confirmed: true,
        });
      }
    }
  }
  return txs;
}

export interface JettonTransferRow { source: string; destination: string; amount: string; transaction_hash: string; transaction_now: number }

/** v3 jetton/transfers rows (addresses already user-friendly). `isOut` decides the direction per row. */
export function tonJettonTransactions(rows: JettonTransferRow[], asset: AssetLike, isOut: (row: JettonTransferRow) => boolean): Transaction[] {
  return rows.map((t) => ({
    hash: base64ToHex(t.transaction_hash),
    from: t.source,
    to: t.destination,
    value: t.amount,
    formatted: formatTonUnits(BigInt(t.amount), asset.decimals),
    symbol: asset.symbol,
    timestamp: t.transaction_now,
    direction: isOut(t) ? "out" as const : "in" as const,
    confirmed: true,
  }));
}
