import type { Chain } from "../../shared/types";

// Public RPCs used ONLY for read-only receipt polling when the configured RPC
// errors (e.g. publicnode answers eth_getTransactionReceipt with 403).
// Never used for broadcasting: the tx is always sent through chain.rpcUrl.
const FALLBACKS: Record<number, string[]> = {
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  10: ["https://mainnet.optimism.io", "https://optimism.drpc.org"],
  56: ["https://bsc-dataseed.bnbchain.org", "https://bsc.drpc.org"],
  100: ["https://gnosis.drpc.org"],
  137: ["https://polygon.drpc.org"],
  250: ["https://rpcapi.fantom.network"],
  324: ["https://zksync.drpc.org"],
  8453: ["https://mainnet.base.org", "https://base.drpc.org"],
  42161: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.drpc.org"],
  42220: ["https://celo.drpc.org"],
  43114: ["https://avalanche.drpc.org"],
  59144: ["https://linea.drpc.org"],
  534352: ["https://scroll.drpc.org"],
};

/** chain.rpcUrl first, then per-chainId public fallbacks (deduped). */
export function evmReceiptRpcUrls(chain: Pick<Chain, "rpcUrl" | "evmChainId">): string[] {
  const extra = chain.evmChainId != null ? FALLBACKS[chain.evmChainId] ?? [] : [];
  return [...new Set([chain.rpcUrl, ...extra].filter(Boolean))];
}
