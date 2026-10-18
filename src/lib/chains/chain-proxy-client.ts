// Server chain proxy client (api/src/routes/chain-proxy.ts): fallback reads through the server for the
// wallet's OWN addresses. Called only after a public read failed, never next to it: every call costs provider
// units. A refusal (403) or an answer with `fallback: "public"` (429 / 502 / 503) pauses that network in memory,
// and the caller keeps its public result. Same rules as the iOS ChainProxyClient.

import type { Chain, Transaction } from "../../shared/types";
import { apiUrl } from "../apiBase";
import { getToken } from "../auth";
import { isRecoveryActive } from "../recovery-flag";

/** App chain name -> proxy network (the route's allowlist, api/src/chain-proxy/networks.ts). Mainnets only. */
const NETWORKS: Readonly<Record<string, string>> = {
  ETHEREUM: "ethereum",
  BASE: "base",
  ARBITRUM: "arbitrum",
  POLYGON: "polygon",
  SOLANA: "solana",
  BITCOIN: "bitcoin",
  LITECOIN: "litecoin",
  BITCOIN_CASH: "bitcoincash",
  DOGECOIN: "dogecoin",
};

const TIMEOUT_MS = 12_000;
const BALANCE_TTL_MS = 30_000;

export type ProxyBody = Record<string, unknown>;

const pausedUntil = new Map<string, number>();
const balanceMemo = new Map<string, { at: number; body: Promise<ProxyBody | null> }>();
const lastHistoryRows = new Map<string, number>();

/** How long a refusal pauses a network: a daily cap (429) longer than the rest. null = no pause. */
export function pauseMs(status: number, fallbackPublic: boolean): number | null {
  if (status === 429) return 600_000;
  if (status === 403 || status === 502 || status === 503 || fallbackPublic) return 120_000;
  return null;
}

/**
 * The proxy network for `chain` right now; null = do not call it (not served, testnet, recovery mode: no server
 * session, signed out, or the network is paused).
 */
export function proxyNetwork(chain: Pick<Chain, "name">, now = Date.now()): string | null {
  const network = NETWORKS[chain.name];
  if (!network || (pausedUntil.get(network) ?? 0) > now) return null;
  if (isRecoveryActive() || !getToken()) return null;
  return network;
}

/** Case-insensitive encodings (hex, bech32, CashAddr) compare lowercased, a CashAddr with or without its prefix;
 *  base58 stays exact. The server answers in its canonical form. */
function canonical(s: string): string {
  const lower = s.toLowerCase();
  if (lower.startsWith("0x") || lower.startsWith("bc1") || lower.startsWith("ltc1")) return lower;
  if (lower.startsWith("bitcoincash:")) return lower.slice("bitcoincash:".length);
  return /^[qp][02-9ac-hj-np-z]{41}$/.test(lower) ? lower : s;
}

function sameAddress(a: unknown, b: string): boolean {
  return typeof a === "string" && canonical(a) === canonical(b);
}

/** One proxy call, with its status; null on a network error or a non-JSON answer. Refusals pause the network. */
export async function proxyPost(network: string, method: string, body: Record<string, unknown>): Promise<{ status: number; body: ProxyBody } | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(apiUrl(`/api/chain/${network}/${method}`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as ProxyBody | null;
    if (!json || typeof json !== "object") return null;
    if (!res.ok) {
      const ms = pauseMs(res.status, json.fallback === "public");
      if (ms) pausedUntil.set(network, Math.max(pausedUntil.get(network) ?? 0, Date.now() + ms));
    }
    return { status: res.status, body: json };
  } catch {
    return null;
  }
}

/** One proxy read; null on any failure (the caller keeps its public result). */
export async function proxyRead(network: string, method: "balance" | "history" | "utxos", address: string): Promise<ProxyBody | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(apiUrl(`/api/chain/${network}/${method}`), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as ProxyBody | null;
    if (!res.ok || !body || typeof body !== "object") {
      const ms = pauseMs(res.status, body?.fallback === "public");
      if (ms) pausedUntil.set(network, Math.max(pausedUntil.get(network) ?? 0, Date.now() + ms));
      return null;
    }
    return sameAddress(body.address, address) ? body : null;
  } catch {
    return null;
  }
}

/** Balance read shared by the native and the token fallback of one refresh (one provider call, not two). */
export function proxyBalance(network: string, address: string, now = Date.now()): Promise<ProxyBody | null> {
  const key = `${network}:${address}`;
  const hit = balanceMemo.get(key);
  if (hit && now - hit.at < BALANCE_TTL_MS) return hit.body;
  // A failed read is memoized too: the other half of the same refresh must not call again.
  const body = proxyRead(network, "balance", address);
  balanceMemo.set(key, { at: now, body });
  return body;
}

/**
 * Whether an empty public first page contradicts the previous answer for the same key (a public node that lost
 * its history answers [] instead of an error). Non-empty answers are recorded.
 */
export function emptyAfterRows(key: string, rows: number): boolean {
  if (rows > 0) {
    lastHistoryRows.set(key, rows);
    return false;
  }
  return (lastHistoryRows.get(key) ?? 0) > 0;
}

/** A public read answered with an HTTP or RPC error: with no proxy answer it reads as an empty page, as before. */
export class PublicReadError extends Error {}

/** One public history page: `rawRows` = rows the node returned before per-asset filtering; `incomplete` = some
 *  of its per-row reads failed. */
export interface PublicHistoryPage {
  transactions: Transaction[];
  hasMore: boolean;
  rawRows: number;
  incomplete?: boolean;
}

type HistoryPage = { transactions: Transaction[]; hasMore: boolean };
const EMPTY_PAGE: HistoryPage = { transactions: [], hasMore: false };

/**
 * Public history first; the proxy (`proxyRows`) only for page 1 when the public read threw, was incomplete, or came
 * back empty after the node had returned rows for the same key. Without a proxy answer the public result stands:
 * an HTTP / RPC error reads as an empty page and a network error throws, as before.
 */
export async function historyWithProxyFallback(
  key: string,
  page: number,
  publicPage: () => Promise<PublicHistoryPage>,
  proxyRows: () => Promise<Transaction[] | null>,
): Promise<HistoryPage> {
  let pub: PublicHistoryPage | null = null;
  let publicError: unknown = null;
  try {
    pub = await publicPage();
    const lost = page === 1 && emptyAfterRows(key, pub.rawRows);
    if (page !== 1 || (!lost && !pub.incomplete)) return { transactions: pub.transactions, hasMore: pub.hasMore };
  } catch (err) {
    if (page !== 1) {
      if (err instanceof PublicReadError) return EMPTY_PAGE;
      throw err;
    }
    publicError = err;
  }
  const rows = await proxyRows();
  if (rows) {
    emptyAfterRows(key, rows.length);
    return { transactions: rows, hasMore: false };
  }
  if (pub) return { transactions: pub.transactions, hasMore: pub.hasMore };
  if (publicError instanceof PublicReadError) return EMPTY_PAGE;
  throw publicError;
}

/** Public reads give up after this long, so a hanging node falls back to the chain proxy. */
export const PUBLIC_TIMEOUT_MS = 15_000;

/** Test hook: forget pauses, memos and history counts. */
export function resetChainProxyState(): void {
  pausedUntil.clear();
  balanceMemo.clear();
  lastHistoryRows.clear();
}
