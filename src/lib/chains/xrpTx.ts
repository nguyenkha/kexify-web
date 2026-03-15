// XRP Ledger transaction building, serialization, signing, and broadcast
// Supports Payment transactions with optional DestinationTag

import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes } from "../../shared/utils";

// ── Constants ───────────────────────────────────────────────────

export const XRP_BASE_FEE = 12n; // 12 drops standard fee

// XRP base58 alphabet
const XRP_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

// ── XRP Binary Serialization ────────────────────────────────────
// XRP uses a type-field encoding: each field has a type code and field ID.
// Type codes: 1=UInt16, 2=UInt32, 6=Amount, 7=Blob, 8=AccountID
// Field encoding: if type < 16 && field < 16: (type<<4)|field in 1 byte
//                 if type < 16 && field >= 16: (type<<4)|0, field in 1 byte
//                 etc.

function encodeFieldId(typeCode: number, fieldId: number): Uint8Array {
  if (typeCode < 16 && fieldId < 16) {
    return new Uint8Array([(typeCode << 4) | fieldId]);
  }
  if (typeCode < 16 && fieldId >= 16) {
    return new Uint8Array([(typeCode << 4), fieldId]);
  }
  if (typeCode >= 16 && fieldId < 16) {
    return new Uint8Array([fieldId, typeCode]);
  }
  return new Uint8Array([0, typeCode, fieldId]);
}

// Known field IDs for Payment transaction
const FIELDS = {
  TransactionType: { type: 1, field: 2 },     // UInt16
  Flags:           { type: 2, field: 2 },     // UInt32
  Sequence:        { type: 2, field: 4 },     // UInt32
  DestinationTag:  { type: 2, field: 14 },    // UInt32
  LastLedgerSequence: { type: 2, field: 27 }, // UInt32
  Amount:          { type: 6, field: 1 },     // Amount
  Fee:             { type: 6, field: 8 },     // Amount
  SigningPubKey:   { type: 7, field: 3 },     // Blob
  TxnSignature:    { type: 7, field: 4 },     // Blob
  Account:         { type: 8, field: 1 },     // AccountID
  Destination:     { type: 8, field: 3 },     // AccountID
} as const;

// Payment = 0
const TX_TYPE_PAYMENT = 0;

function encodeUInt16(value: number): Uint8Array {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function encodeUInt32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

/**
 * Encode an XRP native amount (drops) in the Amount field format.
 * Positive amounts: set bit 62 (positive flag), clear bit 63 (not IOU).
 * Stored as 8 bytes big-endian.
 */
function encodeDropsAmount(drops: bigint): Uint8Array {
  // Native amount: bit 63 = 0 (not IOU), bit 62 = 1 (positive)
  const encoded = drops | (1n << 62n);
  const buf = new Uint8Array(8);
  let v = encoded;
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function encodeVLLength(len: number): Uint8Array {
  if (len <= 192) return new Uint8Array([len]);
  if (len <= 12480) {
    const adjusted = len - 193;
    return new Uint8Array([193 + (adjusted >> 8), adjusted & 0xff]);
  }
  const adjusted = len - 12481;
  return new Uint8Array([241 + (adjusted >> 16), (adjusted >> 8) & 0xff, adjusted & 0xff]);
}

function encodeBlob(data: Uint8Array): Uint8Array {
  const vl = encodeVLLength(data.length);
  const result = new Uint8Array(vl.length + data.length);
  result.set(vl);
  result.set(data, vl.length);
  return result;
}

function encodeAccountID(accountId: Uint8Array): Uint8Array {
  // AccountID is 20 bytes with VL prefix
  return encodeBlob(accountId);
}

function encodeField(fieldDef: { type: number; field: number }, data: Uint8Array): Uint8Array {
  const id = encodeFieldId(fieldDef.type, fieldDef.field);
  const result = new Uint8Array(id.length + data.length);
  result.set(id);
  result.set(data, id.length);
  return result;
}

// ── XRP Address to AccountID ────────────────────────────────────

function xrpBase58Decode(str: string): Uint8Array {
  let num = 0n;
  for (const c of str) {
    const i = XRP_ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`Invalid XRP base58 character: ${c}`);
    num = num * 58n + BigInt(i);
  }
  let leadingZeros = 0;
  for (const c of str) {
    if (c !== XRP_ALPHABET[0]) break;
    leadingZeros++;
  }
  const hex = num === 0n ? "" : num.toString(16).padStart(2, "0");
  const padded = hex.length % 2 ? "0" + hex : hex;
  const bytes = hexToBytes(padded);
  const result = new Uint8Array(leadingZeros + bytes.length);
  result.set(bytes, leadingZeros);
  return result;
}

/** Decode XRP address to 20-byte AccountID */
export function addressToAccountId(address: string): Uint8Array {
  const full = xrpBase58Decode(address);
  // full = version(1) + payload(20) + checksum(4) = 25 bytes
  return full.slice(1, 21);
}

// ── Transaction Building ────────────────────────────────────────

export interface XrpPaymentParams {
  from: string;
  to: string;
  amountDrops: bigint;
  fee: bigint;
  sequence: number;
  lastLedgerSequence: number;
  destinationTag?: number;
  signingPubKey: Uint8Array; // 33-byte compressed public key
}

/**
 * Serialize an XRP Payment transaction for signing.
 * Fields must be sorted by type code, then field ID.
 */
function serializePayment(
  params: XrpPaymentParams,
  includeSig?: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [];

  // Sort order: by type code ascending, then field ID ascending
  // Type 1 (UInt16): TransactionType (field 2)
  parts.push(encodeField(FIELDS.TransactionType, encodeUInt16(TX_TYPE_PAYMENT)));

  // Type 2 (UInt32): Flags (field 2), Sequence (field 4), DestinationTag (field 14), LastLedgerSequence (field 27)
  parts.push(encodeField(FIELDS.Flags, encodeUInt32(0)));
  parts.push(encodeField(FIELDS.Sequence, encodeUInt32(params.sequence)));
  if (params.destinationTag != null) {
    parts.push(encodeField(FIELDS.DestinationTag, encodeUInt32(params.destinationTag)));
  }
  parts.push(encodeField(FIELDS.LastLedgerSequence, encodeUInt32(params.lastLedgerSequence)));

  // Type 6 (Amount): Amount (field 1), Fee (field 8)
  parts.push(encodeField(FIELDS.Amount, encodeDropsAmount(params.amountDrops)));
  parts.push(encodeField(FIELDS.Fee, encodeDropsAmount(params.fee)));

  // Type 7 (Blob): SigningPubKey (field 3), TxnSignature (field 4)
  parts.push(encodeField(FIELDS.SigningPubKey, encodeBlob(params.signingPubKey)));
  if (includeSig) {
    parts.push(encodeField(FIELDS.TxnSignature, encodeBlob(includeSig)));
  }

  // Type 8 (AccountID): Account (field 1), Destination (field 3)
  parts.push(encodeField(FIELDS.Account, encodeAccountID(addressToAccountId(params.from))));
  parts.push(encodeField(FIELDS.Destination, encodeAccountID(addressToAccountId(params.to))));

  // Concatenate
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}

/**
 * Compute the hash to sign: SHA-512Half of (STX\0 prefix + serialized tx)
 * SHA-512Half = first 32 bytes of SHA-512
 */
export function hashForSigning(params: XrpPaymentParams): Uint8Array {
  const serialized = serializePayment(params);
  // STX\0 prefix for signing (0x53545800)
  const prefix = new Uint8Array([0x53, 0x54, 0x58, 0x00]);
  const toHash = new Uint8Array(prefix.length + serialized.length);
  toHash.set(prefix);
  toHash.set(serialized, prefix.length);
  return sha512(toHash).slice(0, 32);
}

/**
 * Assemble a signed transaction blob (hex string) for submission.
 */
export function assembleSignedTx(params: XrpPaymentParams, signature: Uint8Array): string {
  const serialized = serializePayment(params, signature);
  return bytesToHex(serialized).toUpperCase();
}

/**
 * Compute transaction hash: SHA-512Half of (TXN\0 prefix + signed tx bytes)
 */
export function computeTxHash(signedTxHex: string): string {
  const prefix = new Uint8Array([0x54, 0x58, 0x4e, 0x00]); // TXN\0
  const txBytes = hexToBytes(signedTxHex.toLowerCase());
  const toHash = new Uint8Array(prefix.length + txBytes.length);
  toHash.set(prefix);
  toHash.set(txBytes, prefix.length);
  return bytesToHex(sha512(toHash).slice(0, 32)).toUpperCase();
}

// ── RPC Helpers ─────────────────────────────────────────────────

async function xrpRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const data = await res.json();
  return data.result;
}

export interface XrpAccountInfo {
  sequence: number;
  balance: bigint;
  ledgerIndex: number;
}

export async function getAccountInfo(rpcUrl: string, address: string): Promise<XrpAccountInfo> {
  const result = await xrpRpc(rpcUrl, "account_info", [
    { account: address, ledger_index: "validated" },
  ]) as { account_data?: { Sequence?: number; Balance?: string }; ledger_index?: number; error?: string };

  if (result?.error === "actNotFound") {
    throw new Error("Account not found on XRP Ledger. Accounts require a 10 XRP minimum reserve to activate.");
  }
  if (!result?.account_data) {
    throw new Error("Failed to fetch XRP account info");
  }

  return {
    sequence: result.account_data.Sequence ?? 0,
    balance: BigInt(result.account_data.Balance ?? "0"),
    ledgerIndex: result.ledger_index ?? 0,
  };
}

export async function getCurrentLedgerIndex(rpcUrl: string): Promise<number> {
  const result = await xrpRpc(rpcUrl, "ledger", [
    { ledger_index: "validated" },
  ]) as { ledger_index?: number; ledger?: { ledger_index?: number } };
  return result?.ledger?.ledger_index ?? result?.ledger_index ?? 0;
}

export async function broadcastXrpTransaction(rpcUrl: string, txBlob: string): Promise<string> {
  const result = await xrpRpc(rpcUrl, "submit", [
    { tx_blob: txBlob },
  ]) as { engine_result?: string; engine_result_message?: string; tx_json?: { hash?: string }; error?: string; error_message?: string };

  if (result?.error) {
    throw new Error(`Submit failed: ${result.error_message || result.error}`);
  }

  const engineResult = result?.engine_result ?? "";
  if (!engineResult.startsWith("tes") && !engineResult.startsWith("terQUEUED")) {
    throw new Error(`Submit rejected: ${engineResult} — ${result?.engine_result_message ?? ""}`);
  }

  return result?.tx_json?.hash ?? "";
}

export async function waitForXrpConfirmation(
  rpcUrl: string,
  txHash: string,
  onAttempt?: (attempt: number) => void,
  maxAttempts = 30,
  intervalMs = 3000,
): Promise<{ confirmed: boolean; ledgerIndex?: number }> {
  for (let i = 1; i <= maxAttempts; i++) {
    onAttempt?.(i);
    await new Promise((r) => setTimeout(r, intervalMs));

    const result = await xrpRpc(rpcUrl, "tx", [
      { transaction: txHash },
    ]) as { validated?: boolean; meta?: { TransactionResult?: string }; ledger_index?: number; error?: string };

    if (result?.error) continue;

    if (result?.validated) {
      if (result.meta?.TransactionResult !== "tesSUCCESS") {
        throw new Error(`Transaction failed: ${result.meta?.TransactionResult}`);
      }
      return { confirmed: true, ledgerIndex: result.ledger_index };
    }
  }
  return { confirmed: false };
}

export function formatDrops(drops: bigint): string {
  if (drops === 0n) return "0";
  const str = drops.toString().padStart(7, "0");
  const intPart = str.slice(0, str.length - 6) || "0";
  const fracPart = str.slice(str.length - 6).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}
