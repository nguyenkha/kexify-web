// Validates the server's `approvals` answer (api/src/chain-proxy/evm-approvals.ts); malformed rows are dropped.

import type { ProxyBody } from "../chains/chain-proxy-client";
import type { Approval, ApprovalsResult } from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_WORD = /^0x[0-9a-fA-F]{1,64}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

function parseRow(row: unknown): Approval | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.kind !== "erc20" && r.kind !== "nft_all") return null;
  if (typeof r.contract !== "string" || !ADDRESS.test(r.contract)) return null;
  if (typeof r.spender !== "string" || !ADDRESS.test(r.spender)) return null;
  if (typeof r.txHash !== "string" || !TX_HASH.test(r.txHash)) return null;
  if (!Number.isSafeInteger(r.block) || (r.block as number) < 0) return null;
  if (typeof r.flagged !== "boolean") return null;
  const ts = r.timestamp;
  if (ts !== null && (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0)) return null;
  let allowance: bigint | null = null;
  if (r.kind === "erc20") {
    // A fungible grant always has an amount; a zero one is already revoked.
    if (typeof r.allowance !== "string" || !HEX_WORD.test(r.allowance)) return null;
    allowance = BigInt(r.allowance);
    if (allowance === 0n) return null;
  } else if (r.allowance !== null && r.allowance !== undefined) {
    return null;
  }
  return {
    kind: r.kind, contract: r.contract, spender: r.spender, allowance,
    block: r.block as number, txHash: r.txHash, timestamp: ts as number | null, flagged: r.flagged,
  };
}

/** The proxy body as a result, or null when the envelope itself is not an approvals answer. */
export function parseProxyApprovals(body: ProxyBody | null): ApprovalsResult | null {
  if (!body || !Array.isArray(body.approvals)) return null;
  const approvals = body.approvals.map(parseRow).filter((a): a is Approval => a !== null);
  return { approvals, truncated: body.truncated === true, partial: false };
}
