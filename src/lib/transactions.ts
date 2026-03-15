import type { Chain, Asset, Transaction } from "../shared/types";
import { getChainAdapter } from "./chains/adapter";

export type { Transaction } from "../shared/types";

/** Fetch transactions for an address+asset. Pages are 1-indexed. */
export async function fetchTransactions(
  address: string,
  chain: Chain,
  asset: Asset,
  page: number
): Promise<{ transactions: Transaction[]; hasMore: boolean }> {
  const adapter = getChainAdapter(chain.type);
  return adapter.fetchTransactions(address, chain, asset, page);
}
