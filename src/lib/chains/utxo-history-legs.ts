// One UTXO transaction as the adapters show it, from its inputs and outputs (Blockbook / Haskoin
// answers), with the Esplora path's rules: value = |received - sent|, in / out / self by its sign,
// the sender named only when every input shares one address.

import type { Transaction } from "../../shared/types";

export interface Leg { address: string | null; value: bigint }
export interface LegTx { txid: string; confirmed: boolean; time: number | null; inputs: Leg[]; outputs: Leg[] }

export function legTxToTransaction(tx: LegTx, address: string, isMine: (a: string | null) => boolean,
  format: (raw: string) => string, symbol: string): Transaction {
  const sum = (legs: Leg[]) => legs.filter((l) => isMine(l.address)).reduce((s, l) => s + l.value, 0n);
  const net = sum(tx.outputs) - sum(tx.inputs);
  const direction: Transaction["direction"] = net > 0n ? "in" : net < 0n ? "out" : "self";
  let from = address;
  let to = address;
  if (direction === "in") {
    const senders = new Set(tx.inputs.map((l) => l.address).filter(Boolean));
    from = senders.size === 1 ? [...senders][0]! : "";
  } else if (direction === "out") {
    to = tx.outputs.find((l) => l.address && !isMine(l.address))?.address ?? "";
  }
  const value = (net < 0n ? -net : net).toString();
  return {
    hash: tx.txid, from, to, value, formatted: format(value), symbol,
    timestamp: tx.time ?? Math.floor(Date.now() / 1000), direction, confirmed: tx.confirmed,
  };
}

const SATS = /^\d{1,16}$/;

/** A satoshi amount (number or decimal string); throws on anything else (never a silent zero). */
export function satsOf(v: unknown): bigint {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && SATS.test(v)) return BigInt(v);
  throw new Error("bad amount");
}
