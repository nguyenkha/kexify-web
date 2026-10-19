// Which assets get a small chain badge on their icon: every token, and a native coin unless it sits on its own L1
// where the badge would repeat the same logo (ETH on Ethereum, BTC, SOL, ...). ETH on Base keeps the ETH logo + Base badge.

import type { Asset, Chain } from "../shared/types";

/** Ethereum-family L1s whose own coin is ETH-like; native assets there never show a badge. */
const L1_EVM_CHAIN_IDS = new Set([1, 11155111, 17000, 56, 97]);

export function showChainBadge(
  asset: Pick<Asset, "isNative" | "iconUrl">,
  chain: Pick<Chain, "type" | "evmChainId" | "iconUrl">,
): boolean {
  if (!asset.isNative) return true;
  if (chain.type !== "evm") return false;
  if (chain.evmChainId != null && L1_EVM_CHAIN_IDS.has(chain.evmChainId)) return false;
  if (!chain.iconUrl || !asset.iconUrl || chain.iconUrl === asset.iconUrl) return false;
  return true;
}
