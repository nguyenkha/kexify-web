export type { Chain, Asset, ChainType, Settings } from "../shared/types";
import type { Chain, Asset, Settings } from "../shared/types";
import { apiUrl } from "./apiBase";

export async function fetchChains(): Promise<Chain[]> {
  const res = await fetch(apiUrl("/api/chains"));
  if (!res.ok) return [];
  const data = await res.json();
  return data.chains;
}

export async function fetchAssets(chainId?: string): Promise<Asset[]> {
  const url = chainId ? apiUrl(`/api/chains/${chainId}/assets`) : apiUrl("/api/chains/assets");
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.assets;
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetch(apiUrl("/api/settings"));
  if (!res.ok) return {};
  return res.json();
}
