// eth_simulateV1 result -> balance changes (pure). The web (txSimulation.ts) and the iOS chain bundle both use it.

import { parseEthSimulateV1, formatBaseUnits, decodeAbiString } from "./tx-simulation-evm-parse";
import type { EvmSimOptions, KnownToken, SimulatedChange, SimulationResult } from "./txSimulation";

export const ERC20_SYMBOL = "0x95d89b41";
export const ERC20_DECIMALS = "0x313ce567";

/** symbol() / decimals() eth_call results (0x hex) of a token that is not in the app's list. */
export interface ContractMetaHex { symbolHex?: string; decimalsHex?: string }

const isKnown = (known: KnownToken[] | undefined, c: string) => known?.find((t) => t.contractAddress?.toLowerCase() === c);

/** Token contracts in an eth_simulateV1 result that need symbol() / decimals() (not in the app's list). */
export function unknownEvmContracts(result: unknown, from: string, known?: KnownToken[]): string[] {
  const parsed = parseEthSimulateV1(result, from);
  return parsed.deltas.map((d) => d.contractAddress).filter((c): c is string => c !== null && !isKnown(known, c));
}

/**
 * eth_simulateV1 result -> balance changes for `from` (pure; the web and the iOS chain bundle both use it).
 * Listed tokens use the app's metadata; others use the contract's own symbol()/decimals() and are marked not known.
 */
export function evmSimResult(result: unknown, from: string, opts: EvmSimOptions, meta: Record<string, ContractMetaHex> = {}): SimulationResult {
  const parsed = parseEthSimulateV1(result, from);
  if (parsed.reverted) return { changes: [], provider: "rpc", reverted: true };
  const changes = parsed.deltas.map((d): SimulatedChange => {
    let m: { symbol: string; decimals: number; known: boolean };
    if (d.contractAddress === null) {
      m = { symbol: opts.nativeSymbol || "ETH", decimals: 18, known: !!opts.nativeSymbol };
    } else {
      const k = isKnown(opts.knownTokens, d.contractAddress);
      m = k ? { symbol: k.symbol, decimals: k.decimals, known: true } : unlistedMeta(d.contractAddress, meta[d.contractAddress]);
    }
    const abs = d.delta < 0n ? -d.delta : d.delta;
    return {
      asset: { symbol: m.symbol, contractAddress: d.contractAddress, decimals: m.decimals, known: m.known },
      amount: formatBaseUnits(abs, m.decimals),
      rawAmount: abs.toString(),
      direction: d.delta < 0n ? "out" : "in",
    };
  });
  return { changes, provider: "rpc", feeIncluded: false };
}

function unlistedMeta(contract: string, hex: ContractMetaHex | undefined): { symbol: string; decimals: number; known: boolean } {
  let decimals = 0;
  try {
    if (hex?.decimalsHex && hex.decimalsHex !== "0x") decimals = Math.min(Number(BigInt(hex.decimalsHex)), 36);
  } catch { /* raw units */ }
  const symbol = decodeAbiString(hex?.symbolHex) ?? `${contract.slice(0, 6)}…${contract.slice(-4)}`;
  return { symbol, decimals, known: false };
}
