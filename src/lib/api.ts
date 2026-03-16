export type { Chain, Asset, ChainType, Settings } from "../shared/types";
import type { Chain, Asset, Settings } from "../shared/types";
import { apiUrl } from "./apiBase";
import staticConfig from "../config.json";

export async function fetchChains(): Promise<Chain[]> {
  try {
    const res = await fetch(apiUrl("/api/chains"));
    if (!res.ok) return staticConfig.chains as Chain[];
    const data = await res.json();
    return data.chains;
  } catch {
    return staticConfig.chains as Chain[];
  }
}

export async function fetchAssets(chainId?: string): Promise<Asset[]> {
  try {
    const url = chainId ? apiUrl(`/api/chains/${chainId}/assets`) : apiUrl("/api/chains/assets");
    const res = await fetch(url);
    if (!res.ok) return chainId ? (staticConfig.assets as Asset[]).filter(a => a.chainId === chainId) : staticConfig.assets as Asset[];
    const data = await res.json();
    return data.assets;
  } catch {
    return chainId ? (staticConfig.assets as Asset[]).filter(a => a.chainId === chainId) : staticConfig.assets as Asset[];
  }
}

export async function fetchSettings(): Promise<Settings> {
  try {
    const res = await fetch(apiUrl("/api/settings"));
    if (!res.ok) return staticConfig.preferences as Settings;
    return res.json();
  } catch {
    return staticConfig.preferences as Settings;
  }
}
