export type { Chain, Asset, ChainType, Settings } from "../shared/types";
import type { Chain, Asset, Settings } from "../shared/types";
import { apiUrl } from "./apiBase";
import { getCustomTokens } from "./userOverrides";
import { isRecoveryActive } from "./recovery-flag";
import staticConfig from "../config.json";

// Recovery mode must work with the kexify server gone: the bundled config stands in for the chain, asset and
// settings lists, so no page waits on a server that may hang instead of refusing.

export async function fetchChains(): Promise<Chain[]> {
  if (isRecoveryActive()) return staticConfig.chains as Chain[];
  try {
    const res = await fetch(apiUrl("/api/chains"));
    if (!res.ok) return staticConfig.chains as Chain[];
    const data = await res.json();
    return data.chains;
  } catch {
    return staticConfig.chains as Chain[];
  }
}

async function serverAssets(chainId?: string): Promise<Asset[]> {
  const bundled = () => chainId ? (staticConfig.assets as Asset[]).filter(a => a.chainId === chainId) : staticConfig.assets as Asset[];
  if (isRecoveryActive()) return bundled();
  try {
    const url = chainId ? apiUrl(`/api/chains/${chainId}/assets`) : apiUrl("/api/chains/assets");
    const res = await fetch(url);
    return res.ok ? (await res.json()).assets : bundled();
  } catch {
    return bundled();
  }
}

export async function fetchAssets(chainId?: string): Promise<Asset[]> {
  const listed = await serverAssets(chainId);

  // Merge custom tokens from user overrides
  const custom = getCustomTokens()
    .filter(t => !chainId || t.chain_id === chainId)
    .map(t => ({
      id: t.id,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      contractAddress: t.contract_address,
      isNative: false,
      iconUrl: t.icon_url,
      chainId: t.chain_id,
    } as Asset));

  // Dedupe: custom tokens with same contractAddress+chainId as server assets are skipped
  const serverContracts = new Set(
    listed
      .filter(a => a.contractAddress)
      .map(a => `${a.chainId}:${a.contractAddress!.toLowerCase()}`)
  );
  const uniqueCustom = custom.filter(
    c => c.contractAddress && !serverContracts.has(`${c.chainId}:${c.contractAddress.toLowerCase()}`)
  );

  return [...listed, ...uniqueCustom];
}

export async function fetchSettings(): Promise<Settings> {
  if (isRecoveryActive()) return staticConfig.preferences as Settings;
  try {
    const res = await fetch(apiUrl("/api/settings"));
    if (!res.ok) return staticConfig.preferences as Settings;
    return res.json();
  } catch {
    return staticConfig.preferences as Settings;
  }
}
