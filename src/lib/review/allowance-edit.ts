// "Edit spending cap" for token approvals (UX spec: review-and-sign.md "Spending cap"). The wallet rewrites the
// allowance in the bytes it signs; the server policy then judges the edited bytes (it re-parses what it co-signs).
// ERC-20 approve(spender, amount) via eth_sendTransaction and TRC-20 approve via tron_signTransaction only.
// Permit / Permit2 signatures bind the amount and cannot be edited; SPL approve is not editable yet.

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "../../shared/utils";
import { decodeTronRawData } from "../chains/tron-raw-data-decoder";
import { formatUnits, UNLIMITED_THRESHOLD } from "./review-format";

const APPROVE = "095ea7b3";
const UINT256_MAX = 2n ** 256n - 1n;

export type AllowanceInputError = "empty" | "invalid" | "tooManyDecimals" | "tooLarge";

/** User text ("1,250.5" or "1250.5") → base units, or why it is not an amount. Zero is allowed (revoke). */
export function parseAllowanceInput(text: string, decimals: number): { amount: bigint } | { error: AllowanceInputError } {
  const t = text.trim().replace(/[,\s_]/g, "");
  if (t === "") return { error: "empty" };
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return { error: "invalid" };
  const [int, frac = ""] = t.split(".");
  if (frac.length > decimals) return { error: "tooManyDecimals" };
  const amount = BigInt((int || "0") + frac.padEnd(decimals, "0"));
  if (amount > UINT256_MAX) return { error: "tooLarge" };
  return { amount };
}

/** Base units → the text the custom field starts with. */
export function allowanceText(amount: bigint, decimals: number): string {
  return amount >= UNLIMITED_THRESHOLD ? "" : formatUnits(amount, decimals);
}

export type AllowanceChoice = "requested" | "balance" | "custom";

export interface AllowanceOption {
  choice: AllowanceChoice;
  /** Base units (custom: undefined until typed). */
  amount?: bigint;
  /** Shown as "Recommended" (the dApp asked for unlimited and a specific amount is available). */
  recommended: boolean;
}

/**
 * The editor's options: the dApp's request (default), the current balance when it is less than the request
 * (the amount this approval can actually move today), and a custom amount.
 */
export function allowanceOptions(requested: bigint, balance: bigint | null): AllowanceOption[] {
  const unlimited = requested >= UNLIMITED_THRESHOLD;
  const opts: AllowanceOption[] = [{ choice: "requested", amount: requested, recommended: false }];
  if (balance != null && balance > 0n && balance < requested) opts.push({ choice: "balance", amount: balance, recommended: unlimited });
  opts.push({ choice: "custom", recommended: unlimited && !(balance != null && balance > 0n && balance < requested) });
  return opts;
}

/** ERC-20 approve calldata with a new amount (same spender). Throws when the data is not a plain approve. */
export function withEvmApproveAmount(data: string, amount: bigint): string {
  const hex = data.replace(/^0x/, "").toLowerCase();
  if (hex.length !== 8 + 128 || !hex.startsWith(APPROVE) || !/^0{24}/.test(hex.slice(8, 72))) throw new Error("not an ERC-20 approve");
  if (amount < 0n || amount > UINT256_MAX) throw new Error("allowance out of range");
  return "0x" + hex.slice(0, 72) + amount.toString(16).padStart(64, "0");
}

/** A TRON transaction as WalletConnect sends it (txID, raw_data JSON, raw_data_hex). */
export interface TronTxJson {
  txID: string;
  raw_data_hex: string;
  raw_data: { contract?: Array<{ parameter?: { value?: { data?: string } } }> } & Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * TRC-20 approve with a new amount: the 32-byte amount word is rewritten in place in raw_data_hex (same length, so
 * the protobuf framing does not change) and in the JSON raw_data the dApp broadcasts, and txID is recomputed. The
 * result is re-decoded and must still be the same approve to the same spender.
 */
export function withTronApproveAmount(tx: TronTxJson, amount: bigint): TronTxJson {
  const before = decodeTronRawData(hexToBytes(tx.raw_data_hex));
  if (before.kind !== "trc20_approve") throw new Error("not a TRC-20 approve");
  if (amount < 0n || amount > UINT256_MAX) throw new Error("allowance out of range");
  const raw = tx.raw_data_hex.toLowerCase();
  const jsonData = tx.raw_data.contract?.[0]?.parameter?.value?.data;
  if (typeof jsonData !== "string") throw new Error("TRON raw_data has no contract data");
  const oldData = jsonData.replace(/^0x/, "").toLowerCase();
  if (oldData.length !== 136 || !oldData.startsWith(APPROVE) || raw.indexOf(oldData) < 0 || raw.indexOf(oldData) !== raw.lastIndexOf(oldData)) {
    throw new Error("TRON raw_data does not match its JSON view");
  }
  const newData = oldData.slice(0, 72) + amount.toString(16).padStart(64, "0");
  const newRaw = raw.replace(oldData, newData);
  const after = decodeTronRawData(hexToBytes(newRaw));
  if (after.kind !== "trc20_approve" || after.to !== before.to || after.owner !== before.owner
    || after.contractAddress !== before.contractAddress || after.amount !== amount) {
    throw new Error("edited TRON approve does not decode back");
  }
  const contract = tx.raw_data.contract!.map((c, i) => (i === 0
    ? { ...c, parameter: { ...c.parameter, value: { ...c.parameter!.value, data: newData } } }
    : c));
  return { ...tx, raw_data: { ...tx.raw_data, contract }, raw_data_hex: newRaw, txID: bytesToHex(sha256(hexToBytes(newRaw))) };
}
