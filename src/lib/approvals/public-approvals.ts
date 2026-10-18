// Public-RPC fallback for networks the server proxy does not serve (testnets) or when it is unavailable:
// recent Approval / ApprovalForAll logs for the owner, then the live state of each distinct grant.

import { ethRpc } from "../chains/evmTx";
import { stateCalldata } from "./calldata";
import type { Approval, ApprovalKind, ApprovalsResult } from "./types";

export const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
export const APPROVAL_FOR_ALL_TOPIC = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";
const WINDOW = 50_000;
const CHUNK = 10_000;
const MAX_PAIRS = 30;

interface Log { address?: unknown; topics?: unknown; data?: unknown; blockNumber?: unknown; transactionHash?: unknown; logIndex?: unknown }
interface Grant { kind: ApprovalKind; contract: string; spender: string; block: number; logIndex: number; txHash: string; on: boolean }

const hexNum = (v: unknown): number => (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? Number(BigInt(v)) : NaN);
const topicAddress = (t: string): string => "0x" + t.slice(-40);

/** One log as a grant; ERC-721 Approval (4 topics) and malformed logs are skipped. */
export function parseGrantLog(kind: ApprovalKind, log: Log): Grant | null {
  const topics = log.topics;
  if (!Array.isArray(topics) || topics.length !== 3 || !topics.every((t) => typeof t === "string" && /^0x[0-9a-fA-F]{64}$/.test(t))) return null;
  if (typeof log.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(log.address)) return null;
  const block = hexNum(log.blockNumber);
  if (!Number.isFinite(block)) return null;
  const on = kind === "erc20" ? true : typeof log.data === "string" && /[1-9a-fA-F]/.test(log.data.slice(2));
  const idx = hexNum(log.logIndex);
  return {
    kind, contract: log.address.toLowerCase(), spender: topicAddress(topics[2] as string), block,
    logIndex: Number.isFinite(idx) ? idx : 0, txHash: typeof log.transactionHash === "string" ? log.transactionHash : "", on,
  };
}

/** Latest log per (kind, contract, spender) wins; most recent first. */
export function latestGrants(grants: Grant[]): Grant[] {
  const sorted = [...grants].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  const latest = new Map<string, Grant>();
  for (const g of sorted) latest.set(`${g.kind}:${g.contract}:${g.spender}`, g);
  return [...latest.values()].sort((a, b) => b.block - a.block || b.logIndex - a.logIndex);
}

async function readLogs(rpcUrl: string, owner: string, latest: number): Promise<Grant[]> {
  const ownerTopic = "0x" + owner.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  const from = Math.max(0, latest - WINDOW + 1);
  const grants: Grant[] = [];
  for (let start = from; start <= latest; start += CHUNK) {
    const range = { fromBlock: "0x" + start.toString(16), toBlock: "0x" + Math.min(start + CHUNK - 1, latest).toString(16) };
    const [erc20, all] = await Promise.all(
      ([[APPROVAL_TOPIC, "erc20"], [APPROVAL_FOR_ALL_TOPIC, "nft_all"]] as const).map(async ([topic, kind]) => {
        const logs = (await ethRpc(rpcUrl, "eth_getLogs", [{ ...range, topics: [topic, ownerTopic] }])) as Log[];
        if (!Array.isArray(logs)) throw new Error("bad eth_getLogs answer");
        return logs.map((l) => parseGrantLog(kind, l)).filter((g): g is Grant => g !== null);
      }),
    );
    grants.push(...erc20, ...all);
  }
  return grants;
}

/** Live state of one grant; null = could not be read (the row is dropped, never shown stale). */
async function liveState(rpcUrl: string, owner: string, g: Grant): Promise<bigint | null> {
  try {
    const res = await ethRpc(rpcUrl, "eth_call", [{ to: g.contract, data: stateCalldata(g.kind, owner, g.spender) }, "latest"]);
    if (typeof res !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(res)) return null;
    return BigInt(res);
  } catch {
    return null;
  }
}

export async function fetchPublicApprovals(rpcUrl: string, owner: string): Promise<ApprovalsResult> {
  const latest = hexNum(await ethRpc(rpcUrl, "eth_blockNumber", []));
  if (!Number.isFinite(latest)) throw new Error("bad eth_blockNumber answer");
  const grants = latestGrants(await readLogs(rpcUrl, owner, latest)).filter((g) => g.on).slice(0, MAX_PAIRS);
  const states = await Promise.all(grants.map((g) => liveState(rpcUrl, owner, g)));
  const approvals: Approval[] = [];
  grants.forEach((g, i) => {
    const s = states[i];
    if (s === null || s === 0n) return;
    approvals.push({
      kind: g.kind, contract: g.contract, spender: g.spender, allowance: g.kind === "erc20" ? s : null,
      block: g.block, txHash: g.txHash, timestamp: null, flagged: false,
    });
  });
  return { approvals, truncated: false, partial: true };
}
