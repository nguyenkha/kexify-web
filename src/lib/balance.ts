import type { Chain, Asset, BalanceResult } from "../shared/types";
import { getChainAdapter } from "./chains/adapter";
import { getCache, setCache, getStaleCache, balanceCacheKey, tokenBalancesCacheKey } from "./dataCache";

export type { BalanceResult } from "../shared/types";

/** Fetch native balance, using cache if fresh. */
export async function fetchNativeBalance(
  address: string,
  chain: Chain,
  assets: Asset[]
): Promise<BalanceResult | null> {
  const nativeAsset = assets.find(
    (a) => a.chainId === chain.id && a.isNative
  );
  if (!nativeAsset) return null;

  const cacheKey = balanceCacheKey(address, chain.id, nativeAsset.id);

  // Return cached if fresh
  const cached = getCache<BalanceResult>(cacheKey);
  if (cached) return cached;

  const adapter = getChainAdapter(chain.type);
  const result = await adapter.fetchNativeBalance(address, chain, nativeAsset);
  if (result) setCache(cacheKey, result);
  return result;
}

/** Get cached native balance (even stale) for instant display. */
export function getCachedNativeBalance(
  address: string,
  chain: Chain,
  assets: Asset[]
): { data: BalanceResult; fresh: boolean } | null {
  const nativeAsset = assets.find(
    (a) => a.chainId === chain.id && a.isNative
  );
  if (!nativeAsset) return null;
  const cacheKey = balanceCacheKey(address, chain.id, nativeAsset.id);
  return getStaleCache<BalanceResult>(cacheKey);
}

/** Fetch ERC-20 / SPL token balances, using cache if fresh. */
export async function fetchTokenBalances(
  address: string,
  chain: Chain,
  assets: Asset[]
): Promise<BalanceResult[]> {
  const tokenAssets = assets.filter(
    (a) => a.chainId === chain.id && !a.isNative && a.contractAddress
  );
  if (tokenAssets.length === 0) return [];

  const cacheKey = tokenBalancesCacheKey(address, chain.id);

  // Return cached if fresh
  const cached = getCache<BalanceResult[]>(cacheKey);
  if (cached) return cached;

  const adapter = getChainAdapter(chain.type);
  const results = await adapter.fetchTokenBalances(address, chain, tokenAssets);
  setCache(cacheKey, results);
  return results;
}

/** Get cached token balances (even stale) for instant display. */
export function getCachedTokenBalances(
  address: string,
  chain: Chain,
): { data: BalanceResult[]; fresh: boolean } | null {
  const cacheKey = tokenBalancesCacheKey(address, chain.id);
  return getStaleCache<BalanceResult[]>(cacheKey);
}
