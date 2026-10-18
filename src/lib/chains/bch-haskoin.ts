// BCH mainnet reads from Haskoin store (api.haskoin.com, then the blockchain.info mirror), asked
// before Blockchair: Blockchair rate-limits shared IPs (430). Same instances the iOS app reads and
// the API's chain proxy rolls over. Pure fetch + parse: also bundled with bchTx.ts for iOS.

import type { UTXO } from "./btcTx";
import { satsOf, type LegTx } from "./utxo-history-legs";

const MIRRORS = ["https://api.haskoin.com/bch", "https://api.blockchain.info/haskoin-store/bch"];
const TIMEOUT_MS = 8000;
const TXID = /^[0-9a-f]{64}$/;
const UTXO_LIMIT = 1000;

/** GET from the first mirror that answers with JSON; throws when none did. */
async function haskoinGet(path: string): Promise<unknown> {
  let last: unknown = new Error("Haskoin: no mirror");
  for (const base of MIRRORS) {
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Haskoin ${res.status}`);
      return await res.json();
    } catch (err) { last = err; }
  }
  throw last;
}

const enc = (address: string) => encodeURIComponent(address);
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const height = (block: unknown): number | null => {
  const b = isObj(block) ? block : {};
  return b.mempool === undefined && typeof b.height === "number" && b.height > 0 ? b.height : null;
};

/** Confirmed balance in satoshis. */
export async function haskoinBalance(address: string): Promise<bigint> {
  const j = await haskoinGet(`/address/${enc(address)}/balance`);
  if (!isObj(j)) throw new Error("Haskoin: bad balance");
  return satsOf(j.confirmed);
}

/** Unspent outputs in Esplora shape (mempool ones unconfirmed). */
export async function haskoinUtxos(address: string): Promise<UTXO[]> {
  const rows = await haskoinGet(`/address/${enc(address)}/unspent?limit=${UTXO_LIMIT}`);
  if (!Array.isArray(rows)) throw new Error("Haskoin: bad UTXO list");
  // A full page may not be the whole set: let the caller read a source that returns all of it.
  if (rows.length >= UTXO_LIMIT) throw new Error("Haskoin: UTXO list may be cut");
  return rows.map((r) => {
    if (!isObj(r) || typeof r.txid !== "string" || !TXID.test(r.txid) || !Number.isInteger(r.index) || (r.index as number) < 0) {
      throw new Error("Haskoin: malformed UTXO");
    }
    const h = height(r.block);
    return { txid: r.txid, vout: r.index as number, value: Number(satsOf(r.value)), status: h ? { confirmed: true, block_height: h } : { confirmed: false } };
  });
}

/** One page of the address's transactions, newest first (server-side offset). */
export async function haskoinHistory(address: string, page: number, pageSize: number): Promise<LegTx[]> {
  const rows = await haskoinGet(`/address/${enc(address)}/transactions/full?limit=${pageSize}&offset=${(page - 1) * pageSize}`);
  if (!Array.isArray(rows)) throw new Error("Haskoin: bad history");
  const legs = (v: unknown) => {
    if (!Array.isArray(v)) throw new Error("Haskoin: tx without inputs / outputs");
    return v.map((l) => ({
    address: isObj(l) && typeof l.address === "string" ? l.address : null,
      value: isObj(l) && l.value !== undefined ? satsOf(l.value) : 0n,
    }));
  };
  return rows.map((t) => {
    if (!isObj(t) || typeof t.txid !== "string" || !TXID.test(t.txid)) throw new Error("Haskoin: malformed tx");
    const h = height(t.block);
    return { txid: t.txid, confirmed: h !== null, time: typeof t.time === "number" && t.time > 0 ? t.time : null,
      inputs: legs(t.inputs), outputs: legs(t.outputs) };
  });
}
