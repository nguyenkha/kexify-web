// Transaction simulation — predicts token balance changes before signing.
// Detects provider from RPC URL and uses the appropriate API method.

import { detectEvmSimProvider } from "./providerDetect";

export interface SimulatedChange {
  asset: {
    symbol: string;
    name?: string;
    contractAddress: string | null; // null for native
    decimals: number;
    iconUrl?: string;
  };
  amount: string;       // human-readable (e.g. "1.5")
  rawAmount: string;    // base units (e.g. "1500000")
  direction: "in" | "out";
}

export interface SimulationResult {
  changes: SimulatedChange[];
  provider: string;
  error?: string;
}

interface EvmTxParams {
  from: string;
  to: string;
  value?: string;    // hex
  data?: string;     // hex
  gas?: string;      // hex
}

/**
 * Simulate an EVM transaction and return predicted balance changes.
 * Detects the provider from rpcUrl and uses the appropriate API.
 * Returns null if the provider doesn't support simulation.
 */
export async function simulateEvmTransaction(
  rpcUrl: string,
  tx: EvmTxParams,
): Promise<SimulationResult | null> {
  const provider = detectEvmSimProvider(rpcUrl);
  if (provider === "none") return null;

  try {
    switch (provider) {
      case "alchemy":
        return await simulateAlchemy(rpcUrl, tx);
      case "tenderly":
        return await simulateTenderly(rpcUrl, tx);
      case "infura":
        return await simulateInfura(rpcUrl, tx);
      default:
        return null;
    }
  } catch (err) {
    return { changes: [], provider, error: String(err) };
  }
}

// ── Alchemy ─────────────────────────────────────────────────

async function simulateAlchemy(rpcUrl: string, tx: EvmTxParams): Promise<SimulationResult> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

// ── Infura ──────────────────────────────────────────────────

// ERC-20 Transfer event signature
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function simulateInfura(rpcUrl: string, tx: EvmTxParams): Promise<SimulationResult> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_simulateV1",
      params: [{
        blockStateCalls: [{
          calls: [tx],
          traceTransfers: true,
        }],
      }, "latest"],
    }),
  });

  if (!res.ok) {
    return { changes: [], provider: "infura", error: `HTTP ${res.status}` };
  }

  const data = await res.json();
  if (data.error) {
    return { changes: [], provider: "infura", error: data.error.message };
  }

  // Parse Transfer logs from simulation result
  const blocks = data.result || [];
  const changes: SimulatedChange[] = [];

  for (const block of blocks) {
    for (const call of block.calls || []) {
      if (call.status !== "0x1") continue;
      for (const log of call.logs || []) {
        if (log.topics?.[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;

        const contractAddress = log.address;
        const from = "0x" + (log.topics[1] as string).slice(26);
        const to = "0x" + (log.topics[2] as string).slice(26);
        const rawAmount = log.data ? BigInt(log.data).toString() : "0";

        const isOut = from.toLowerCase() === tx.from.toLowerCase();
        const isIn = to.toLowerCase() === tx.from.toLowerCase();
        if (!isOut && !isIn) continue;

        changes.push({
          asset: {
            symbol: "ERC20",  // Infura doesn't return token metadata
            contractAddress,
            decimals: 18,     // Unknown — caller can enrich later
          },
          amount: rawAmount,
          rawAmount,
          direction: isOut ? "out" : "in",
        });
      }
    }
  }

  return { changes, provider: "infura" };
}

// ── Helpers ─────────────────────────────────────────────────

function formatRawAmount(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const str = raw.padStart(decimals + 1, "0");
  const int = str.slice(0, str.length - decimals) || "0";
  const frac = str.slice(str.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
