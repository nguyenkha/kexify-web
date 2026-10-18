// Dogecoin transaction support: BTC's legacy P2PKH builder and sighash (btcTx.ts) with DOGE's address
// versions, per-kB fees, its 0.01 DOGE dust rule and no RBF. Mainnet only (no public DOGE testnet indexer).
// Public reads from the browser: SoChain v3 and Blockchair (both CORS-open; the Blockbook the server and
// iOS read first sends no CORS headers). The server chain proxy is the fallback (chain-proxy-utxo.ts).

import { sha256 } from "@noble/hashes/sha256";
import { base58check } from "@scure/base";
import {
  type UTXO,
  type BtcUnsignedTx,
  type BtcInput,
  type BtcOutput,
  selectUtxos,
  maxSendableSats as btcMaxSendableSats,
  estimateFee,
} from "./btcTx";
import { rawTxid } from "./ltc-blockbook";

export {
  type UTXO,
  type BtcUnsignedTx as DogeUnsignedTx,
  legacySighash,
  getCompressedPublicKey,
  pubKeyHash,
  makeP2PKHScriptSig,
  serializeLegacyTx,
  computeLegacyTxid,
  formatSats,
} from "./btcTx";

const b58check = base58check(sha256);

export const DOGE_SOCHAIN = "https://sochain.com/api/v3";
export const DOGE_BLOCKCHAIR = "https://api.blockchair.com/dogecoin";
const DOGE_BLOCKCYPHER = "https://api.blockcypher.com/v1/doge/main";
const TIMEOUT_MS = 8000;

/** Dogecoin Core 1.14 soft dust limit: an output below 0.01 DOGE costs an extra 0.01 DOGE fee, so none is made. */
export const DOGE_DUST_SATS = 1_000_000n;
/** Wallet default and mining minimum: 0.01 DOGE/kB = 1,000 sat/byte. */
export const DOGE_MIN_FEE_RATE = 1000;
/** Ceiling on a quoted rate (1 DOGE/kB): a bad quote must not burn coins. */
export const DOGE_MAX_FEE_RATE = 100_000;

/** DOGE base58 version bytes: P2PKH "D" (0x1e), P2SH "9" / "A" (0x16). */
const P2PKH = 0x1e;
const P2SH = 0x16;

const concat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) { out.set(x, o); o += x.length; }
  return out;
};

// ── Addresses ───────────────────────────────────────────────────

/** DOGE address -> scriptPubKey. Throws on anything we cannot safely pay to (other coins' versions included). */
export function addressToScriptPubKey(address: string): Uint8Array {
  const decoded = b58check.decode(address);
  if (decoded.length !== 21) throw new Error(`Invalid DOGE address: ${address}`);
  const h = decoded.slice(1);
  if (decoded[0] === P2PKH) return concat(new Uint8Array([0x76, 0xa9, 0x14]), h, new Uint8Array([0x88, 0xac]));
  if (decoded[0] === P2SH) return concat(new Uint8Array([0xa9, 0x14]), h, new Uint8Array([0x87]));
  throw new Error(`Unsupported DOGE address format: ${address}`);
}

export function isValidDogeAddress(address: string): boolean {
  try {
    addressToScriptPubKey(address);
    return true;
  } catch {
    return false;
  }
}

/** DOGE P2PKH address of a 20-byte public key hash. */
export function dogeAddressFromHash(hash160: Uint8Array): string {
  const payload = new Uint8Array(21);
  payload[0] = P2PKH;
  payload.set(hash160, 1);
  return b58check.encode(payload);
}

// ── Build ───────────────────────────────────────────────────────

/** Fee of a legacy DOGE tx at `feeRate` sat/byte (what the review shows). */
export function estimateDogeFee(numInputs: number, feeRate: number, hasChange: boolean): bigint {
  return estimateFee(numInputs, feeRate, hasChange, "p2pkh");
}

/** What Max can send from the `maxInputs` largest confirmed coins (one output, fee included). */
export function maxSendableSats(utxos: UTXO[], feeRate: number, maxInputs: number = Infinity, destAddress?: string) {
  return btcMaxSendableSats(utxos, feeRate, "p2pkh", maxInputs, destAddress);
}

/**
 * P2PKH spend from `changeAddress`: version 1, final sequences (DOGE has no opt-in RBF), change below the
 * dust limit folded into the fee. Every input is P2PKH, signed with the legacy sighash.
 */
export function buildDogeTransaction(
  toAddress: string,
  amountSats: bigint,
  utxos: UTXO[],
  feeRate: number,
  changeAddress: string,
  useAllUtxos: boolean = false,
  maxInputs: number = Infinity,
): BtcUnsignedTx {
  if (amountSats < DOGE_DUST_SATS) throw new Error("DOGE_BELOW_DUST: the amount must be at least 0.01 DOGE");
  if (!Number.isFinite(feeRate) || feeRate < DOGE_MIN_FEE_RATE || feeRate > DOGE_MAX_FEE_RATE) throw new Error(`Invalid DOGE fee rate: ${feeRate}`);
  const to = addressToScriptPubKey(toAddress);
  const change = addressToScriptPubKey(changeAddress);
  const sel = selectUtxos(utxos, amountSats, feeRate, "p2pkh", useAllUtxos, toAddress, changeAddress, maxInputs, DOGE_DUST_SATS);

  const inputs: BtcInput[] = sel.selected.map((u) => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), sequence: 0xffffffff }));
  const outputs: BtcOutput[] = [{ value: amountSats, scriptPubKey: to }];
  if (sel.change > 0n) outputs.push({ value: sel.change, scriptPubKey: change });
  return { version: 1, inputs, outputs, locktime: 0 };
}

// ── Public reads ────────────────────────────────────────────────

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** "9.51727163" -> 951727163n; throws on anything else. */
export function coinToSats(v: unknown): bigint {
  const m = typeof v === "string" ? /^(\d{1,11})(?:\.(\d{1,8}))?$/.exec(v) : null;
  if (!m) throw new Error("DOGE: bad amount");
  return BigInt(m[1] + (m[2] ?? "").padEnd(8, "0"));
}

/** SoChain v3 `data` of a success answer. */
async function sochain(path: string): Promise<Record<string, unknown>> {
  const j = (await getJson(`${DOGE_SOCHAIN}${path}`)) as { status?: unknown; data?: Record<string, unknown> };
  if (j?.status !== "success" || !j.data || typeof j.data !== "object") throw new Error("SoChain: bad answer");
  return j.data;
}

/** Confirmed balance in satoshis (SoChain). */
export async function fetchDogeBalance(address: string): Promise<bigint> {
  return coinToSats((await sochain(`/balance/DOGE/${encodeURIComponent(address)}`)).confirmed);
}

export interface DogeHistoryRow { txid: string; received: bigint; sent: bigint; time: number | null; confirmed: boolean }

/** One page of up to 10 txs (SoChain's page size), newest first: per-address amounts, no counterparties. */
export async function fetchDogeHistoryPage(address: string, page: number): Promise<DogeHistoryRow[]> {
  const d = await sochain(`/transactions/DOGE/${encodeURIComponent(address)}/${page}`);
  if (!Array.isArray(d.transactions)) throw new Error("SoChain: bad history");
  return (d.transactions as Record<string, unknown>[]).map((t) => {
    if (typeof t?.hash !== "string" || !/^[0-9a-f]{64}$/.test(t.hash)) throw new Error("SoChain: bad txid");
    return {
      txid: t.hash, received: coinToSats(t.value_received), sent: coinToSats(t.value_sent),
      time: typeof t.time === "number" && t.time > 0 ? t.time : null,
      confirmed: typeof t.block === "number" && t.block > 0,
    };
  });
}

const BLOCKCHAIR_UTXO_LIMIT = 1000;

/** UTXOs (Blockchair dashboard: one call, up to 1000 coins; unconfirmed ones flagged). */
export async function fetchUtxos(address: string): Promise<UTXO[]> {
  const j = (await getJson(`${DOGE_BLOCKCHAIR}/dashboards/address/${encodeURIComponent(address)}?limit=1,${BLOCKCHAIR_UTXO_LIMIT}`)) as
    { data?: Record<string, { utxo?: unknown; address?: { unspent_output_count?: unknown } }> };
  const entry = j?.data?.[address];
  if (!entry || !Array.isArray(entry.utxo)) throw new Error("Blockchair: bad UTXO list");
  // A cut list could miss the largest coins: let the caller fall back instead of building from part of it.
  const count = entry.address?.unspent_output_count;
  if (typeof count !== "number" || count > entry.utxo.length) {
    throw new Error("Blockchair: UTXO list cut");
  }
  return (entry.utxo as Record<string, unknown>[]).map((u) => {
    if (typeof u?.transaction_hash !== "string" || !/^[0-9a-f]{64}$/.test(u.transaction_hash) || !Number.isSafeInteger(u.index)
      || !Number.isSafeInteger(u.value) || (u.value as number) <= 0 || typeof u.block_id !== "number") throw new Error("Blockchair: bad UTXO");
    const h = u.block_id as number;
    return { txid: u.transaction_hash, vout: u.index as number, value: u.value as number,
      status: h > 0 ? { confirmed: true, block_height: h } : { confirmed: false } };
  });
}

/** One suggested rate in sat/byte: BlockCypher's low per-kB quote (blocks are far from full), clamped to [0.01, 1] DOGE/kB. */
export async function fetchDogeFeeRate(): Promise<number> {
  try {
    const j = (await getJson(DOGE_BLOCKCYPHER)) as { low_fee_per_kb?: unknown };
    const perKb = j?.low_fee_per_kb;
    if (typeof perKb === "number" && Number.isFinite(perKb) && perKb > 0) {
      return Math.min(DOGE_MAX_FEE_RATE, Math.max(DOGE_MIN_FEE_RATE, Math.ceil(perKb / 1000)));
    }
  } catch { /* the wallet default below confirms in practice: blocks are far from full */ }
  return DOGE_MIN_FEE_RATE;
}

// ── Broadcast ───────────────────────────────────────────────────

/** A node saying it already has this tx (mempool or chain). */
const DUPLICATE = /already (known|exists|in (the )?(mempool|block ?chain))|txn-already|-27:/i;

/** Blockchair push first, BlockCypher after when Blockchair gives no node verdict. Returns the txid. */
export async function broadcastDogeTx(rawHex: string): Promise<string> {
  const txid = rawTxid(rawHex);
  let first = "";
  let verdict: string | null = null;
  try {
    const res = await fetch(`${DOGE_BLOCKCHAIR}/push/transaction`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${rawHex}`, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = (await res.json().catch(() => null)) as { data?: { transaction_hash?: unknown }; context?: { error?: unknown } } | null;
    if (res.ok && j?.data?.transaction_hash === txid) return txid;
    const err = typeof j?.context?.error === "string" ? j.context.error : `HTTP ${res.status}`;
    if (DUPLICATE.test(err)) return txid;
    // 400 "Invalid transaction. Error: ..." is the node's own verdict: the same bytes go nowhere else.
    if (res.status === 400 && /Invalid transaction/i.test(err)) verdict = err;
    first = `${err}; `;
  } catch (e) {
    first = `${e instanceof Error ? e.message : e}; `;
  }
  if (verdict) throw new Error(`DOGE broadcast failed: ${verdict}`);
  const res = await fetch(`${DOGE_BLOCKCYPHER}/txs/push`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tx: rawHex }), signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (res.ok || DUPLICATE.test(text)) return txid;
  throw new Error(`DOGE broadcast failed: ${first}${text}`);
}

// ── Confirmation ────────────────────────────────────────────────

/** Block height once mined, null while unconfirmed (SoChain transaction). */
async function txHeight(txid: string): Promise<number | null> {
  const d = await sochain(`/transaction/DOGE/${txid}`);
  if (d.hash !== txid) throw new Error("SoChain: answer for another tx");
  return typeof d.confirmations === "number" && d.confirmations > 0 && typeof d.block_height === "number" ? d.block_height : null;
}

export async function waitForDogeConfirmation(
  txid: string,
  onPoll?: (attempt: number) => void,
  maxAttempts = 60,
  intervalMs = 5000,
): Promise<{ confirmed: boolean; blockHeight?: number }> {
  for (let i = 0; i < maxAttempts; i++) {
    onPoll?.(i + 1);
    const h = await txHeight(txid).catch(() => null);
    if (typeof h === "number") return { confirmed: true, blockHeight: h };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { confirmed: false };
}

export function formatDogeFee(sats: bigint): string {
  return (Number(sats) / 1e8).toFixed(8).replace(/\.?0+$/, "");
}
