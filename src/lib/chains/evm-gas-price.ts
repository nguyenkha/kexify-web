// Gas price for legacy (EIP-155) EVM txs, the only kind the API co-signs.
//
// eth_gasPrice is about the current base fee + a tip, so a tx priced at exactly that falls below the base fee after
// one full block (+12.5%) and can sit unmined (Sepolia, 2026-10-18). A legacy tx pays its whole gas price (no refund),
// so the standard level adds only enough headroom for two full blocks: ceil(1.25 x base fee) + tip, never below
// eth_gasPrice. Same rule as iOS EvmGasPrice.swift.

import { EVM_FEE_MULTIPLIER, type FeeLevel } from "../../components/sendTypes";
import { fetchKonfirmEthGasPrice } from "./konfirm-fees";

export interface EvmGasQuote {
  /** eth_gasPrice. */
  gasPrice: bigint;
  /** The latest block's baseFeePerGas; null on a chain without EIP-1559. */
  baseFee: bigint | null;
}

/** max(gasPrice, ceil(1.25 x baseFee) + tip); gasPrice alone without a base fee. */
export function evmGasPriceWithHeadroom({ gasPrice, baseFee }: EvmGasQuote): bigint {
  if (baseFee == null || baseFee <= 0n) return gasPrice;
  const tip = gasPrice > baseFee ? gasPrice - baseFee : 0n;
  const priced = (5n * baseFee + 3n) / 4n + tip;
  return priced > gasPrice ? priced : gasPrice;
}

/** Gas price per fee level. On an EIP-1559 chain no level goes below the current base fee + tip (eth_gasPrice). */
export function evmLevelGasPrices(quote: EvmGasQuote): Record<FeeLevel, bigint> {
  const standard = evmGasPriceWithHeadroom(quote);
  const floor = quote.baseFee != null && quote.baseFee > 0n
    ? (quote.gasPrice > quote.baseFee ? quote.gasPrice : quote.baseFee)
    : 0n;
  const level = (l: FeeLevel) => {
    const p = BigInt(Math.round(Number(standard) * EVM_FEE_MULTIPLIER[l]));
    return p > floor ? p : floor;
  };
  return { low: level("low"), medium: level("medium"), high: level("high") };
}

async function rpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json() as { result?: unknown; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message || "rpc error");
  return data.result;
}

/** eth_gasPrice from Konfirm on Ethereum mainnet, else (or when Konfirm fails) from the chain's RPC. */
async function gasPrice(rpcUrl: string, evmChainId?: number | null): Promise<unknown> {
  if (evmChainId === 1) {
    try {
      return "0x" + (await fetchKonfirmEthGasPrice()).toString(16);
    } catch { /* fall back to the chain's RPC */ }
  }
  return rpc(rpcUrl, "eth_gasPrice", []);
}

/** eth_gasPrice + the latest block's base fee. A failed block read only drops the headroom. */
export async function fetchEvmGasQuote(rpcUrl: string, evmChainId?: number | null): Promise<EvmGasQuote> {
  const [gp, block] = await Promise.all([
    gasPrice(rpcUrl, evmChainId),
    rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]).catch(() => null),
  ]);
  if (typeof gp !== "string") throw new Error("no gas price");
  const baseHex = (block as { baseFeePerGas?: unknown } | null)?.baseFeePerGas;
  return { gasPrice: BigInt(gp), baseFee: typeof baseHex === "string" ? BigInt(baseHex) : null };
}
