// Free balance-change simulation for a decoded tx (EVM eth_simulateV1 / Solana simulateTransaction).
// Read-only RPC calls; the tx itself is never sent. Bitcoin-family txs have no simulation.

import { useEffect, useMemo, useState } from "react";
import { base64 } from "@scure/base";
import { simulateEvmTransaction, SIMULATION_UNAVAILABLE, type SimulationResult } from "../../lib/txSimulation";
import { simulateSolanaTransaction } from "../../lib/tx-simulation-solana";
import type { DecodedRawTx } from "../../lib/expert/decode-raw-tx";
import type { Chain } from "../../lib/api";

export type SimState = { status: "idle" } | { status: "running" } | { status: "done"; result: SimulationResult } | { status: "noChain" };

type Plan = { status: "idle" } | { status: "noChain" } | { status: "run"; run: () => Promise<SimulationResult | null> };

/** The chain to simulate on: EVM by the signed chainId, Solana by the user's pick. */
export function simulationChain(d: DecodedRawTx | null, chains: Chain[], solanaChainId: string): Chain | undefined {
  if (!d) return undefined;
  if (d.kind === "evm") return chains.find((c) => c.type === "evm" && c.evmChainId === d.tx.chainId);
  if (d.kind === "solana") return chains.find((c) => c.id === solanaChainId);
  return undefined;
}

function planFor(d: DecodedRawTx | null, chain: Chain | undefined, from: string): Plan {
  if (!d || d.kind === "utxo") return { status: "idle" };
  if (!chain?.rpcUrl) return { status: "noChain" };
  const rpc = chain.rpcUrl;
  if (d.kind === "solana") return { status: "run", run: () => simulateSolanaTransaction(rpc, base64.decode(d.base64), d.tx.from) };
  const sender = d.tx.from ?? from.trim();
  const to = d.tx.to;
  if (!/^0x[0-9a-fA-F]{40}$/.test(sender) || !to) return { status: "idle" };
  return {
    status: "run",
    run: () => simulateEvmTransaction(rpc, { from: sender, to, value: `0x${d.tx.value.toString(16)}`, data: d.tx.data, gas: `0x${d.tx.gasLimit.toString(16)}` }),
  };
}

export function useDecodedTxSimulation(d: DecodedRawTx | null, chain: Chain | undefined, from: string): SimState {
  const plan = useMemo(() => planFor(d, chain, from), [d, chain, from]);
  const [done, setDone] = useState<{ plan: Plan; result: SimulationResult } | null>(null);
  useEffect(() => {
    if (plan.status !== "run") return;
    let live = true;
    const finish = (r: SimulationResult | null) => {
      if (live) setDone({ plan, result: r ?? SIMULATION_UNAVAILABLE });
    };
    plan.run().then(finish, () => finish(null));
    return () => {
      live = false;
    };
  }, [plan]);
  if (plan.status !== "run") return plan;
  return done?.plan === plan ? { status: "done", result: done.result } : { status: "running" };
}
