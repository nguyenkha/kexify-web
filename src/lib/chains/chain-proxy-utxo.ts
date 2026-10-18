// BTC / LTC / BCH answers of the server chain proxy (api/src/chain-proxy/utxo-reader.ts) mapped to what the UTXO
// adapters and send flows use. The server rolls over free public indexers; this is only the fallback after the
// client's own public read failed.

import type { Chain } from "../../shared/types";
import { proxyBalance, proxyNetwork, proxyPost, proxyRead, type ProxyBody } from "./chain-proxy-client";
import type { FeeRates } from "./btcTx";
import type { ProxyTxRow } from "./chain-proxy-evm";
import type { UTXO } from "./btcTx";

const TXID = /^[0-9a-f]{64}$/;

function sats(v: unknown): bigint | null {
  return typeof v === "string" && /^\d{1,16}$/.test(v) ? BigInt(v) : null;
}

/** `POST /chain/<utxo network>/balance` -> confirmed satoshis (what the adapters show). null = unreadable. */
export function parseUtxoBalance(body: ProxyBody): bigint | null {
  return sats(body.confirmed);
}

/** `POST /chain/<utxo network>/utxos` -> Esplora-shaped UTXOs. null when the server cut the list (`truncated`: the
 *  largest coins may be missing) or any row is malformed (never half a list). */
export function parseUtxoList(body: ProxyBody): UTXO[] | null {
  if (!Array.isArray(body.utxos) || body.truncated !== false) return null;
  const out: UTXO[] = [];
  for (const u of body.utxos as Record<string, unknown>[]) {
    const status = u?.status as { confirmed?: unknown; block_height?: unknown } | undefined;
    if (typeof u?.txid !== "string" || !TXID.test(u.txid) || !Number.isSafeInteger(u.vout) || (u.vout as number) < 0
      || !Number.isSafeInteger(u.value) || (u.value as number) <= 0 || typeof status?.confirmed !== "boolean") return null;
    out.push({
      txid: u.txid, vout: u.vout as number, value: u.value as number,
      status: status.confirmed && Number.isSafeInteger(status.block_height) && (status.block_height as number) > 0
        ? { confirmed: true, block_height: status.block_height as number } : { confirmed: status.confirmed },
    });
  }
  return out;
}

interface UtxoTxRow { txid?: unknown; confirmed?: unknown; time?: unknown; received?: unknown; sent?: unknown; from?: unknown; to?: unknown }

/** `POST /chain/<utxo network>/history` -> rows with the adapters' rules: value = |received - sent|. */
export function parseUtxoHistory(body: ProxyBody, address: string): ProxyTxRow[] | null {
  if (!Array.isArray(body.transactions)) return null;
  const rows: ProxyTxRow[] = [];
  for (const t of body.transactions as UtxoTxRow[]) {
    const received = sats(t?.received);
    const sent = sats(t?.sent);
    if (typeof t?.txid !== "string" || !TXID.test(t.txid) || received === null || sent === null) return null;
    const net = received - sent;
    const direction = net > 0n ? "in" : net < 0n ? "out" : "self";
    const other = (v: unknown) => (typeof v === "string" ? v : "");
    rows.push({
      hash: t.txid,
      from: direction === "in" ? other(t.from) : address,
      to: direction === "out" ? other(t.to) : address,
      value: (net < 0n ? -net : net).toString(),
      timestamp: typeof t.time === "number" && t.time > 0 ? t.time : Math.floor(Date.now() / 1000),
      direction,
      confirmed: t.confirmed === true,
    });
  }
  return rows;
}

export async function proxyUtxoBalance(chain: Pick<Chain, "name">, address: string): Promise<bigint | null> {
  const network = proxyNetwork(chain);
  const body = network ? await proxyBalance(network, address) : null;
  return body ? parseUtxoBalance(body) : null;
}

export async function proxyUtxoHistory(chain: Pick<Chain, "name">, address: string): Promise<ProxyTxRow[] | null> {
  const network = proxyNetwork(chain);
  const body = network ? await proxyRead(network, "history", address) : null;
  return body ? parseUtxoHistory(body, address) : null;
}

/**
 * UTXOs for a send: the public read first, the proxy only when it threw. The proxy's list is no more trusted than
 * a public one: the server's co-sign checks every input's prevout itself.
 */
export async function utxosWithProxyFallback(chain: Pick<Chain, "name">, address: string, publicRead: () => Promise<UTXO[]>): Promise<UTXO[]> {
  try {
    return await publicRead();
  } catch (err) {
    const network = proxyNetwork(chain);
    const body = network ? await proxyRead(network, "utxos", address) : null;
    const list = body ? parseUtxoList(body) : null;
    if (list) return list;
    throw err;
  }
}

/** Networks whose proxy serves fees and broadcast (api/src/chain-proxy/utxo-sources.ts; not BCH). */
const SENDS_THROUGH_PROXY = new Set(["bitcoin", "litecoin"]);

function sendNetwork(chain: Pick<Chain, "name">): string | null {
  const network = proxyNetwork(chain);
  return network && SENDS_THROUGH_PROXY.has(network) ? network : null;
}

const FEE_KEYS = ["fastestFee", "halfHourFee", "hourFee", "economyFee", "minimumFee"] as const;

/** `POST /chain/<network>/fees` -> sat/vB rates; null when any is not a positive number. */
export function parseUtxoFees(body: ProxyBody): FeeRates | null {
  const out = {} as FeeRates;
  for (const k of FEE_KEYS) {
    const v = body[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 10_000) return null;
    out[k] = v;
  }
  return out;
}

/** Fee rates: the public read first, the proxy (Alchemy first on the server) only when it threw. */
export async function feesWithProxyFallback(chain: Pick<Chain, "name">, publicRead: () => Promise<FeeRates>): Promise<FeeRates> {
  try {
    return await publicRead();
  } catch (err) {
    const network = sendNetwork(chain);
    const r = network ? await proxyPost(network, "fees", {}) : null;
    const rates = r?.status === 200 ? parseUtxoFees(r.body) : null;
    if (rates) return rates;
    throw err;
  }
}

/**
 * Broadcast: the public node first; when it failed, the proxy relays the same bytes (the server checks every input
 * is this address's). A node rejection through the proxy is final and reported; any other proxy failure rethrows
 * the public error.
 */
export async function broadcastWithProxyFallback(chain: Pick<Chain, "name">, address: string, rawHex: string,
  publicBroadcast: () => Promise<string>): Promise<string> {
  try {
    return await publicBroadcast();
  } catch (err) {
    const network = sendNetwork(chain);
    const r = network ? await proxyPost(network, "broadcast", { address, rawTx: rawHex }) : null;
    if (r?.status === 200 && typeof r.body.txid === "string" && TXID.test(r.body.txid)) return r.body.txid;
    if (r?.status === 422 && typeof r.body.reason === "string") throw new Error(`Broadcast failed: ${r.body.reason}`);
    throw err;
  }
}
