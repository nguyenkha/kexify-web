// Names for the rows: token / collection from the asset list or the chain, spender from known contracts or the address book.

import { fetchAssets } from "../api";
import { fetchEvmContractName, fetchEvmTokenMetadata } from "../tokenMetadata";
import { addressLabel } from "../address-label";
import { knownEvmContract } from "../review/known-contracts";
import { shortAddress } from "../review/review-format";
import type { Chain } from "../../shared/types";
import type { Approval } from "./types";

export interface ContractInfo { symbol: string; name: string; decimals: number | null }

/** Name of the spender when we know it; null = show the short address. */
export function spenderLabel(address: string): string | null {
  return knownEvmContract(address) ?? addressLabel(address);
}

/** Metadata per lowercase contract: the chain asset list first, then the contract itself, else the short address. */
export async function contractInfos(chain: Chain, approvals: Approval[]): Promise<Map<string, ContractInfo>> {
  const out = new Map<string, ContractInfo>();
  const assets = await fetchAssets(chain.id).catch(() => []);
  for (const a of assets) {
    if (a.contractAddress) out.set(a.contractAddress.toLowerCase(), { symbol: a.symbol, name: a.name, decimals: a.decimals });
  }
  const missing = [...new Set(approvals.map((a) => a.contract.toLowerCase()))].filter((c) => !out.has(c));
  await Promise.all(missing.map(async (c) => {
    try {
      const m = await fetchEvmTokenMetadata(c, chain.rpcUrl, chain.evmChainId);
      out.set(c, { symbol: m.symbol, name: m.name || m.symbol, decimals: Number.isFinite(m.decimals) ? m.decimals : null });
    } catch {
      const name = (await fetchEvmContractName(c, chain.rpcUrl)) || shortAddress(c);
      out.set(c, { symbol: name, name, decimals: null });
    }
  }));
  return out;
}

/**
 * Tokens the revoke review may treat as known. Only one whose decimals() answered counts as fungible: approve(x, 0) on
 * an ERC-721 approves NFT id 0, and the shared review calls it a revoke only for a known token, so a contract whose
 * decimals are unknown is never vouched for here (the review then shows the plain approval of the bytes).
 */
export function revokeOriginTokens(contract: string, info?: ContractInfo): { address: string; symbol: string; decimals: number }[] {
  if (info?.decimals == null) return [];
  return [{ address: contract, symbol: info.symbol || shortAddress(contract), decimals: info.decimals }];
}
