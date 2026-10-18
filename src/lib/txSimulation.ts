// Transaction simulation — predicts balance changes before signing (an estimate, never a guarantee).
// Alchemy / Tenderly RPCs use their richer methods; every other EVM RPC gets the standard eth_simulateV1.
// Any failure (method missing, error, timeout) returns null so the caller keeps its static estimate.

import { detectEvmSimProvider } from "./providerDetect";
import { formatBaseUnits } from "./tx-simulation-evm-parse";
import { evmSimResult, unknownEvmContracts, ERC20_SYMBOL, ERC20_DECIMALS, type ContractMetaHex } from "./tx-simulation-evm-result";

export interface SimulatedChange {
  asset: {
    symbol: string;
    name?: string;
    contractAddress: string | null; // null for native
    decimals: number;
    iconUrl?: string;
    /** false = symbol read from the token contract itself (not in the app's token list); show the address too */
    known?: boolean;
  };
  amount: string;       // human-readable (e.g. "1.5")
  rawAmount: string;    // base units (e.g. "1500000")
  direction: "in" | "out";
}

export interface SimulationResult {
  changes: SimulatedChange[];
  provider: string;
  /** Solana post-balances include the network fee; EVM transfer traces do not. */
  feeIncluded?: boolean;
  /** The node predicts the transaction would fail (revert). Informational only, never blocks signing. */
  reverted?: boolean;
  error?: string;
}

interface EvmTxParams {
  from: string;
  to: string;
  value?: string;    // hex
  data?: string;     // hex
  gas?: string;      // hex
}

/** Token metadata the app already knows (chain asset list / balances); avoids trusting a contract's own symbol. */
export interface KnownToken {
  contractAddress: string | null;
  symbol: string;
  decimals: number;
}

export interface EvmSimOptions {
  nativeSymbol?: string;
  knownTokens?: KnownToken[];
}

export const SIMULATION_TIMEOUT_MS = 5000;

/** Marker the review shows as "could not simulate" (unsupported method, RPC error, timeout). Never blocks signing. */
export const SIMULATION_UNAVAILABLE: SimulationResult = { changes: [], provider: "rpc", error: "unavailable" };

/** JSON-RPC call with a hard timeout. Throws on HTTP / RPC errors. */
export async function simRpc(rpcUrl: string, method: string, params: unknown[], timeoutMs = SIMULATION_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "RPC error");
  return data.result;
}

/**
 * Simulate an EVM transaction and return predicted balance changes for `tx.from`.
 * Returns null when simulation is unavailable or fails — callers fall back to the static estimate.
 */
export async function simulateEvmTransaction(
  rpcUrl: string,
  tx: EvmTxParams,
  opts: EvmSimOptions = {},
): Promise<SimulationResult | null> {
  const provider = detectEvmSimProvider(rpcUrl);
  try {
    let r: SimulationResult;
    if (provider === "alchemy") r = markKnown(await simulateAlchemy(rpcUrl, tx), opts.knownTokens);
    else if (provider === "tenderly") r = markKnown(await simulateTenderly(rpcUrl, tx), opts.knownTokens);
    else r = await simulateEthV1(rpcUrl, tx, opts);
    return r.error ? null : r;
  } catch {
    return null;
  }
}

/** Vendor results carry the contract's own symbol: only native and app-listed tokens count as known (priced). */
function markKnown(r: SimulationResult, known: KnownToken[] = []): SimulationResult {
  for (const c of r.changes) {
    const addr = c.asset.contractAddress?.toLowerCase();
    c.asset.known = !addr || known.some((t) => t.contractAddress?.toLowerCase() === addr);
  }
  return r;
}

// ── Alchemy ─────────────────────────────────────────────────

async function simulateAlchemy(rpcUrl: string, tx: EvmTxParams): Promise<SimulationResult> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(SIMULATION_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_simulateAssetChanges",
      params: [tx],
    }),
  });

  if (!res.ok) {
    return { changes: [], provider: "alchemy", error: `HTTP ${res.status}` };
  }

  const data = await res.json();
  if (data.error) {
    return { changes: [], provider: "alchemy", error: data.error.message };
  }

  const result = data.result;
  if (!result?.changes) {
    return { changes: [], provider: "alchemy" };
  }

  const changes: SimulatedChange[] = result.changes.map((c: {
    assetType: string;
    changeType: string;
    from: string;
    to: string;
    rawAmount: string;
    contractAddress?: string;
    decimals: number;
    symbol: string;
    name: string;
    logo?: string;
    amount: string;
  }) => {
    // Determine direction: if `from` matches tx.from, it's outgoing
    const isOut = c.from.toLowerCase() === tx.from.toLowerCase();
    return {
      asset: {
        symbol: c.symbol || "???",
        name: c.name,
        contractAddress: c.assetType === "NATIVE" ? null : (c.contractAddress || null),
        decimals: c.decimals ?? 18,
        iconUrl: c.logo,
      },
      amount: c.amount || formatRawAmount(c.rawAmount, c.decimals ?? 18),
      rawAmount: c.rawAmount || "0",
      direction: isOut ? "out" : "in",
    };
  });

  return { changes, provider: "alchemy" };
}

// ── Tenderly ────────────────────────────────────────────────

async function simulateTenderly(rpcUrl: string, tx: EvmTxParams): Promise<SimulationResult> {
  // Tenderly RPC supports a custom JSON-RPC method
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(SIMULATION_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tenderly_simulateTransaction",
      params: [{
        from: tx.from,
        to: tx.to,
        value: tx.value || "0x0",
        data: tx.data || "0x",
        gas: tx.gas,
      }, "latest"],
    }),
  });

  if (!res.ok) {
    return { changes: [], provider: "tenderly", error: `HTTP ${res.status}` };
  }

  const data = await res.json();
  if (data.error) {
    return { changes: [], provider: "tenderly", error: data.error.message };
  }

  const assetChanges = data.result?.asset_changes || data.result?.transaction?.transaction_info?.asset_changes || [];

  const changes: SimulatedChange[] = assetChanges.map((c: {
    token_info?: { symbol: string; name: string; decimals: number; contract_address?: string; logo?: string };
    type?: string;
    amount?: string;
    raw_amount?: string;
    from?: string;
    to?: string;
  }) => {
    const isOut = c.from?.toLowerCase() === tx.from.toLowerCase();
    const decimals = c.token_info?.decimals ?? 18;
    return {
      asset: {
        symbol: c.token_info?.symbol || "???",
        name: c.token_info?.name,
        contractAddress: c.token_info?.contract_address || null,
        decimals,
        iconUrl: c.token_info?.logo,
      },
      amount: c.amount || formatRawAmount(c.raw_amount || "0", decimals),
      rawAmount: c.raw_amount || "0",
      direction: isOut ? "out" : "in",
    };
  });

  return { changes, provider: "tenderly" };
}

// ── Standard eth_simulateV1 (any node that implements it) ───

async function simulateEthV1(rpcUrl: string, tx: EvmTxParams, opts: EvmSimOptions): Promise<SimulationResult> {
  const call: Record<string, string> = { from: tx.from, to: tx.to, value: tx.value || "0x0", data: tx.data || "0x" };
  if (tx.gas) call.gas = tx.gas;
  const result = await simRpc(rpcUrl, "eth_simulateV1", [
    { blockStateCalls: [{ calls: [call] }], traceTransfers: true },
    "latest",
  ]);
  const provider = detectEvmSimProvider(rpcUrl) === "infura" ? "infura" : "rpc";
  // Unlisted tokens: symbol() / decimals() raw hex from the contract (shown with the address, never priced)
  const meta: Record<string, ContractMetaHex> = {};
  await Promise.all(unknownEvmContracts(result, tx.from, opts.knownTokens).map(async (c) => {
    const [symbolHex, decimalsHex] = await Promise.all([
      simRpc(rpcUrl, "eth_call", [{ to: c, data: ERC20_SYMBOL }, "latest"]).catch(() => null),
      simRpc(rpcUrl, "eth_call", [{ to: c, data: ERC20_DECIMALS }, "latest"]).catch(() => null),
    ]);
    meta[c] = { symbolHex: typeof symbolHex === "string" ? symbolHex : undefined, decimalsHex: typeof decimalsHex === "string" ? decimalsHex : undefined };
  }));
  return { ...evmSimResult(result, tx.from, opts, meta), provider };
}

// ── Helpers ─────────────────────────────────────────────────

function formatRawAmount(raw: string, decimals: number): string {
  try {
    return formatBaseUnits(BigInt(raw || "0"), decimals);
  } catch {
    return "0";
  }
}
