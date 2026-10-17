// LTC mainnet Blockbook (litecoinblockexplorer.net, API v2), asked before litecoinspace.org: its
// Esplora API answers in 6-20 s or hangs (measured 2026-10-18; Blockbook 0.6-1.9 s). Same instance
// the iOS app reads balances from and the API's UTXO chain binding looks prevouts up on.
// Callers fall back to Esplora on any error here.

import { sha256 } from "@noble/hashes/sha256";
import type { UTXO } from "./btcTx";
import { bytesToHex, hexToBytes } from "../../shared/utils";

/** Esplora base this Blockbook stands in for (ltcApiUrl of the mainnet explorer). */
export const LTC_ESPLORA_MAINNET = "https://litecoinspace.org/api";
const LTC_BLOCKBOOK_MAINNET = "https://litecoinblockexplorer.net/api/v2";
const TIMEOUT_MS = 8000;

/** The Blockbook for an Esplora base, or null (testnet / custom explorer: Esplora only). */
export function ltcBlockbookFor(esploraBase: string): string | null {
  return esploraBase.replace(/\/+$/, "") === LTC_ESPLORA_MAINNET ? LTC_BLOCKBOOK_MAINNET : null;
}

/** A node's answer to sendtx ("-26: min relay fee not met"): final, the same bytes go nowhere else. */
export class BlockbookNodeVerdict extends Error {}

async function bbJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => null) as { error?: unknown } | null;
  if (!res.ok || body === null || typeof body.error === "string") {
    const err = typeof body?.error === "string" ? body.error : "bad response";
    if (res.status >= 400 && res.status < 500 && /^-\d+:/.test(err)) throw new BlockbookNodeVerdict(err);
    throw new Error(`Blockbook ${res.status}: ${err}`);
  }
  return body;
}

const SATS = /^\d{1,16}$/;

/** Address UTXOs in Esplora shape (mempool ones unconfirmed). */
export async function blockbookUtxos(bb: string, address: string): Promise<UTXO[]> {
  const rows = await bbJson(`${bb}/utxo/${encodeURIComponent(address)}`);
  if (!Array.isArray(rows)) throw new Error("Blockbook: bad UTXO list");
  return rows.map((r: { txid?: unknown; vout?: unknown; value?: unknown; confirmations?: unknown; height?: unknown }) => {
    if (typeof r.txid !== "string" || !/^[0-9a-f]{64}$/.test(r.txid) || !Number.isInteger(r.vout) || (r.vout as number) < 0
        || typeof r.value !== "string" || !SATS.test(r.value)) {
      throw new Error("Blockbook: malformed UTXO");
    }
    const confirmed = typeof r.confirmations === "number" && r.confirmations > 0;
    return {
      txid: r.txid, vout: r.vout as number, value: Number(r.value),
      status: { confirmed, block_height: confirmed && typeof r.height === "number" ? r.height : undefined },
    };
  });
}

/** Confirmed balance in base units (what the Esplora read counts: chain_stats only). */
export async function blockbookBalance(bb: string, address: string): Promise<bigint> {
  const j = await bbJson(`${bb}/address/${encodeURIComponent(address)}?details=basic`) as { balance?: unknown };
  if (typeof j.balance !== "string" || !SATS.test(j.balance)) throw new Error("Blockbook: bad balance");
  return BigInt(j.balance);
}

/** Relays a raw tx; returns its txid. */
export async function blockbookBroadcast(bb: string, rawHex: string): Promise<string> {
  const j = await bbJson(`${bb}/sendtx/`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: rawHex }) as { result?: unknown };
  if (typeof j.result !== "string" || !/^[0-9a-f]{64}$/.test(j.result)) throw new Error("Blockbook: bad sendtx result");
  return j.result;
}

/** Block height once the tx is mined, null while it is in the mempool. Throws when unknown. */
export async function blockbookTxHeight(bb: string, txid: string): Promise<number | null> {
  const j = await bbJson(`${bb}/tx/${txid}`) as { txid?: unknown; confirmations?: unknown; blockHeight?: unknown };
  if (j.txid !== txid) throw new Error("Blockbook: answer for another tx");
  return typeof j.confirmations === "number" && j.confirmations > 0 && typeof j.blockHeight === "number" ? j.blockHeight : null;
}

/** txid of a raw tx (legacy or SegWit: hash of the bytes without marker, flag and witnesses). */
export function rawTxid(rawHex: string): string {
  const b = hexToBytes(rawHex);
  const segwit = b[4] === 0 && b[5] === 1;
  let p = segwit ? 6 : 4;
  const varint = () => {
    const f = b[p++];
    if (f < 0xfd) return f;
    const n = f === 0xfd ? 2 : f === 0xfe ? 4 : 8;
    let v = 0;
    for (let i = 0; i < n; i++) v += b[p++] * 2 ** (8 * i);
    return v;
  };
  const start = p;
  const inputs = varint();
  for (let k = 0; k < inputs; k++) { p += 36; const len = varint(); p += len + 4; } // outpoint, scriptSig, sequence
  const outputs = varint();
  for (let k = 0; k < outputs; k++) { p += 8; const len = varint(); p += len; } // value, scriptPubKey
  if (!Number.isInteger(p) || p + 4 > b.length) throw new Error("rawTxid: truncated tx");
  const stripped = new Uint8Array([...b.subarray(0, 4), ...b.subarray(start, p), ...b.subarray(b.length - 4)]);
  return bytesToHex(sha256(sha256(stripped)).reverse());
}
