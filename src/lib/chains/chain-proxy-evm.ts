// EVM answers of the server chain proxy (api/src/chain-proxy/alchemy-client.ts) mapped to what evmAdapter shows.
// The provider lists every ERC-20 the address holds, spam included: only the app's known tokens are kept.

import type { Asset, Chain, Transaction } from "../../shared/types";
import { proxyBalance, proxyNetwork, proxyRead, type ProxyBody } from "./chain-proxy-client";

export type ProxyTxRow = Omit<Transaction, "formatted" | "symbol">;

function hexAmount(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(v)) return null;
  return BigInt(v);
}

/** `POST /chain/:network/balance` -> native wei + token balances by lowercased contract. null = unreadable. */
export function parseEvmBalance(body: ProxyBody): { native: bigint; tokens: Map<string, bigint> } | null {
  const native = hexAmount(body.native);
  if (native === null || !Array.isArray(body.tokens)) return null;
  const tokens = new Map<string, bigint>();
  for (const t of body.tokens as { contract?: unknown; balance?: unknown }[]) {
    const amount = hexAmount(t?.balance);
    if (typeof t?.contract === "string" && amount !== null) tokens.set(t.contract.toLowerCase(), amount);
  }
  return { native, tokens };
}

/**
 * `POST /chain/:network/history` -> rows of one asset: native = "external" transfers, a token = its "erc20"
 * transfers by contract (spam tokens never match a listed asset). Provider rows are mined transfers with a value:
 * no approvals, failed txs or fees.
 */
export function parseEvmHistory(body: ProxyBody, address: string, asset: Asset): ProxyTxRow[] | null {
  if (!Array.isArray(body.transfers)) return null;
  const me = address.toLowerCase();
  const contract = asset.contractAddress?.toLowerCase();
  const rows: ProxyTxRow[] = [];
  for (const t of body.transfers as Record<string, unknown>[]) {
    const matches = asset.isNative
      ? t.category === "external"
      : t.category === "erc20" && typeof t.contract === "string" && t.contract.toLowerCase() === contract;
    const value = hexAmount(t.rawValue);
    if (!matches || value === null || typeof t.hash !== "string") continue;
    const from = typeof t.from === "string" ? t.from : "";
    const to = typeof t.to === "string" ? t.to : "";
    const sent = from.toLowerCase() === me;
    const received = to.toLowerCase() === me;
    if (!sent && !received) continue;
    const ms = typeof t.timestamp === "string" ? Date.parse(t.timestamp) : NaN;
    rows.push({
      hash: t.hash,
      from,
      to,
      value: value.toString(),
      timestamp: Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000),
      direction: sent && received ? "self" : sent ? "out" : "in",
      confirmed: true,
    });
  }
  return rows;
}

/** Balances through the proxy, or null when it is not available for this chain or failed. */
export async function proxyEvmBalances(chain: Chain, address: string) {
  const network = proxyNetwork(chain);
  if (!network) return null;
  const body = await proxyBalance(network, address);
  return body ? parseEvmBalance(body) : null;
}

/** History rows of one asset through the proxy, or null when it is not available or failed. */
export async function proxyEvmHistory(chain: Chain, address: string, asset: Asset): Promise<ProxyTxRow[] | null> {
  const network = proxyNetwork(chain);
  if (!network) return null;
  const body = await proxyRead(network, "history", address);
  return body ? parseEvmHistory(body, address, asset) : null;
}
