import type { Approval } from "./types";

const APPROVE = "0x095ea7b3";
const SET_APPROVAL_FOR_ALL = "0xa22cb465";
const ALLOWANCE = "0xdd62ed3e";
const IS_APPROVED_FOR_ALL = "0xe985e9c5";

const word = (address: string): string => address.replace(/^0x/, "").toLowerCase().padStart(64, "0");

/** The transaction data that takes the grant back: approve(spender, 0) or setApprovalForAll(operator, false). */
export function revokeCalldata(a: Pick<Approval, "kind" | "spender">): string {
  return (a.kind === "erc20" ? APPROVE : SET_APPROVAL_FOR_ALL) + word(a.spender) + "0".repeat(64);
}

/** eth_call data that reads the live state of one grant. */
export function stateCalldata(kind: Approval["kind"], owner: string, spender: string): string {
  return (kind === "erc20" ? ALLOWANCE : IS_APPROVED_FOR_ALL) + word(owner) + word(spender);
}
