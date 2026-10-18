// Custom EVM networks and RPC overrides (Expert mode): validation and the Chain / Asset they become.
// Safety: the network's chainId is what the user declared and checked against eth_chainId when added. Signing
// always uses that declared chainId, refuses an RPC that answers another one (assertRpcChainId), and the API
// refuses a request whose signed chainId differs from the declared one (/sign/init evmChainId).

import type { Asset, Chain } from "../shared/types";
import type { CustomNetwork } from "./userOverrides";

const CUSTOM_PREFIX = "custom-evm:";

/** Chain.name / id of a custom network. "TESTNET" in the name makes isTestnetChain() treat it as one. */
export function customChainName(n: Pick<CustomNetwork, "chain_id" | "testnet">): string {
  return `CUSTOM_${n.testnet ? "TESTNET_" : ""}${n.chain_id}`;
}

export function isCustomChain(chain: Pick<Chain, "id">): boolean {
  return chain.id.startsWith(CUSTOM_PREFIX);
}

export function customNetworkChain(n: CustomNetwork): Chain {
  return {
    // The chain id is part of the shown name, so a custom network can never pass for a built-in one.
    id: `${CUSTOM_PREFIX}${n.chain_id}`, name: customChainName(n), displayName: `${n.name} (${n.chain_id})`, type: "evm", coinType: 60,
    evmChainId: n.chain_id, rpcUrl: n.rpc_url, explorerUrl: n.explorer_url ?? "", iconUrl: null, custom: true,
  };
}

/** The only asset a custom network has: its native coin (tokens are not supported there). */
export function customNetworkAsset(n: CustomNetwork): Asset {
  return {
    id: `${CUSTOM_PREFIX}${n.chain_id}:native`, symbol: n.symbol, name: n.symbol, decimals: 18, contractAddress: null,
    isNative: true, iconUrl: null, chainId: `${CUSTOM_PREFIX}${n.chain_id}`,
  };
}

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/**
 * https anywhere; plain http only to this machine (Anvil / Hardhat on 127.0.0.1:8545), since an https page may
 * not call any other http URL. Returns an i18n error key, or null when the URL is usable.
 */
export function rpcUrlError(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "customNetwork.err.url";
  }
  if (u.username || u.password) return "customNetwork.err.url";
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && LOCAL_HOST.test(u.hostname)) return null;
  return "customNetwork.err.http";
}

/** eth_chainId of an RPC, or throws (timeout 6 s). */
export async function fetchRpcChainId(rpcUrl: string, timeoutMs = 6000): Promise<number> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const data = (await res.json()) as { result?: unknown };
    if (typeof data.result !== "string" || !/^0x[0-9a-f]+$/i.test(data.result)) throw new Error("Bad eth_chainId answer");
    const id = Number(BigInt(data.result));
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Bad eth_chainId answer");
    return id;
  } finally {
    clearTimeout(timer);
  }
}

/** Before building a tx: the RPC must serve the network's declared chain, or nothing is signed. */
export async function assertRpcChainId(rpcUrl: string, expected: number): Promise<void> {
  const actual = await fetchRpcChainId(rpcUrl);
  if (actual !== expected) throw new Error(`This RPC serves chain ${actual}, not this network's chain ${expected}. Nothing was signed.`);
}

export interface CustomNetworkInput {
  name: string;
  chainId: string;
  rpcUrl: string;
  symbol: string;
  explorerUrl: string;
  testnet: boolean;
}

/** Field checks before any network call; returns an i18n error key or null. */
export function customNetworkInputError(i: CustomNetworkInput, builtIn: Chain[], existing: CustomNetwork[]): string | null {
  const name = i.name.trim();
  if (!name || name.length > 40) return "customNetwork.err.name";
  const lower = name.toLowerCase();
  if (builtIn.some((c) => c.displayName.toLowerCase() === lower || c.name.toLowerCase() === lower)) return "customNetwork.err.nameTaken";
  if (existing.some((n) => n.name.toLowerCase() === lower)) return "customNetwork.err.nameTaken";
  if (!/^[1-9]\d{0,15}$/.test(i.chainId.trim()) || !Number.isSafeInteger(Number(i.chainId))) return "customNetwork.err.chainId";
  const id = Number(i.chainId);
  if (builtIn.some((c) => c.evmChainId === id)) return "customNetwork.err.builtIn";
  if (existing.some((n) => n.chain_id === id)) return "customNetwork.err.exists";
  if (!/^[A-Za-z0-9.]{1,10}$/.test(i.symbol.trim())) return "customNetwork.err.symbol";
  const rpc = rpcUrlError(i.rpcUrl);
  if (rpc) return rpc;
  if (i.explorerUrl.trim() && !/^https:\/\/[^\s]+$/i.test(i.explorerUrl.trim())) return "customNetwork.err.explorer";
  return null;
}

/** Validated input → stored network; throws when the RPC's eth_chainId is not the declared one. */
export async function verifyCustomNetwork(i: CustomNetworkInput): Promise<CustomNetwork> {
  const chainId = Number(i.chainId);
  const actual = await fetchRpcChainId(i.rpcUrl.trim());
  if (actual !== chainId) throw new ChainIdMismatchError(actual, chainId);
  return {
    chain_id: chainId, name: i.name.trim(), rpc_url: i.rpcUrl.trim(), symbol: i.symbol.trim(),
    ...(i.explorerUrl.trim() ? { explorer_url: i.explorerUrl.trim().replace(/\/+$/, "") } : {}),
    testnet: i.testnet, added_at: Date.now(),
  };
}

export class ChainIdMismatchError extends Error {
  readonly actual: number;
  readonly declared: number;
  constructor(actual: number, declared: number) {
    super(`RPC chain ID ${actual} does not match ${declared}`);
    this.actual = actual;
    this.declared = declared;
  }
}
