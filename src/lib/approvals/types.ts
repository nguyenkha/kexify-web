export type ApprovalKind = "erc20" | "nft_all";

export interface Approval {
  kind: ApprovalKind;
  /** Token or collection contract. */
  contract: string;
  spender: string;
  /** ERC-20 allowance in base units; null for a collection-wide grant. */
  allowance: bigint | null;
  block: number;
  txHash: string;
  /** Unix seconds of the grant; null when unknown (public fallback). */
  timestamp: number | null;
  /** The server's fraud check flagged the spender. */
  flagged: boolean;
}

export interface ApprovalsResult {
  approvals: Approval[];
  /** The server hit its log cap: older approvals may be missing. */
  truncated: boolean;
  /** Public-RPC fallback: only the recent window was read. */
  partial: boolean;
}

/** "Unlimited" = allowance of 2^128 or more. */
export const UNLIMITED_ALLOWANCE = 2n ** 128n;

export const isUnlimited = (a: Approval): boolean => a.allowance !== null && a.allowance >= UNLIMITED_ALLOWANCE;

export const approvalKey = (a: Pick<Approval, "kind" | "contract" | "spender">): string =>
  `${a.kind}:${a.contract.toLowerCase()}:${a.spender.toLowerCase()}`;
