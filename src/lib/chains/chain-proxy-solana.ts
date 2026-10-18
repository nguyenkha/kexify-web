// Solana answers of the server chain proxy (api/src/chain-proxy/solana-reader.ts) mapped to what solanaAdapter
// shows. History rows apply the adapter's own display rules to the server's per-transaction summary.

import type { Asset, Chain } from "../../shared/types";
import { proxyBalance, proxyNetwork, proxyRead, type ProxyBody } from "./chain-proxy-client";
import type { ProxyTxRow } from "./chain-proxy-evm";
import { KNOWN_PROGRAMS } from "./solanaTx";

function intAmount(v: unknown): bigint | null {
  if (typeof v !== "string" || !/^-?\d{1,40}$/.test(v)) return null;
  return BigInt(v);
}

/** `POST /chain/solana/balance` -> lamports + SPL balances by mint. null = unreadable. */
export function parseSolanaBalance(body: ProxyBody): { native: bigint; tokens: Map<string, bigint> } | null {
  const native = intAmount(body.native);
  if (native === null || native < 0n || !Array.isArray(body.tokens)) return null;
  const tokens = new Map<string, bigint>();
  for (const t of body.tokens as { mint?: unknown; amount?: unknown }[]) {
    const amount = intAmount(t?.amount);
    if (typeof t?.mint === "string" && amount !== null) tokens.set(t.mint, amount);
  }
  return { native, tokens };
}

interface TxSummary {
  signature?: unknown; blockTime?: unknown; confirmationStatus?: unknown; failed?: unknown; details?: unknown;
  fee?: unknown; nativeDelta?: unknown; nativeCounterparty?: unknown; hasTokenBalanceChange?: unknown;
  tokenDeltas?: { mint?: unknown; delta?: unknown; counterparty?: unknown }[]; programs?: unknown[];
}

/** One summary as a row of `asset`, or null when the adapter would not list it there. */
function summaryRow(s: TxSummary, address: string, asset: Asset): ProxyTxRow | null {
  if (typeof s.signature !== "string" || s.details !== true) return null; // no tx body: the adapter skips it too
  const base = {
    hash: s.signature,
    timestamp: typeof s.blockTime === "number" && s.blockTime > 0 ? s.blockTime : Math.floor(Date.now() / 1000),
    confirmed: s.confirmationStatus === "finalized" || s.confirmationStatus === "confirmed",
    failed: s.failed === true,
  };

  if (!asset.isNative) {
    const t = (s.tokenDeltas ?? []).find((d) => d?.mint === asset.contractAddress);
    const d = intAmount(t?.delta);
    if (!t || d === null || d === 0n) return null;
    const other = typeof t.counterparty === "string" ? t.counterparty : "...";
    return d > 0n
      ? { ...base, from: other, to: address, value: d.toString(), direction: "in" }
      : { ...base, from: address, to: other, value: (-d).toString(), direction: "out" };
  }

  const programs = (s.programs ?? []).filter((p): p is string => typeof p === "string");
  // Pure SPL transfer (basic programs + token changes): it shows on the token's page instead.
  if (programs.length === 0 && s.hasTokenBalanceChange === true) return null;
  const diff = intAmount(s.nativeDelta) ?? 0n;
  const fee = intAmount(s.fee) ?? 0n;
  const other = typeof s.nativeCounterparty === "string" ? s.nativeCounterparty : "...";
  let row: ProxyTxRow = { ...base, from: address, to: address, value: "0", direction: "self" };
  if (diff > 0n) row = { ...row, from: other, value: diff.toString(), direction: "in" };
  else if (diff < 0n) {
    const sent = -diff - fee;
    row = { ...row, to: other, value: (sent > 0n ? sent : -diff).toString(), direction: "out" };
  }
  if (programs.length > 0) {
    const label = KNOWN_PROGRAMS[programs[0]];
    return { ...row, to: label ?? (row.to === address ? "..." : row.to), isContractCall: true };
  }
  return row;
}

/** `POST /chain/solana/history` -> rows of one asset, newest first. null = unreadable. */
export function parseSolanaHistory(body: ProxyBody, address: string, asset: Asset): ProxyTxRow[] | null {
  if (!Array.isArray(body.transactions)) return null;
  return (body.transactions as TxSummary[]).map((s) => summaryRow(s, address, asset)).filter((r): r is ProxyTxRow => r !== null);
}

/** Balances through the proxy, or null when it is not available for this chain or failed. */
export async function proxySolanaBalances(chain: Chain, address: string) {
  const network = proxyNetwork(chain);
  if (!network) return null;
  const body = await proxyBalance(network, address);
  return body ? parseSolanaBalance(body) : null;
}

/** History rows of one asset through the proxy, or null when it is not available or failed. */
export async function proxySolanaHistory(chain: Chain, address: string, asset: Asset): Promise<ProxyTxRow[] | null> {
  const network = proxyNetwork(chain);
  if (!network) return null;
  const body = await proxyRead(network, "history", address);
  return body ? parseSolanaHistory(body, address, asset) : null;
}
