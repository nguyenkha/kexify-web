// Decode a raw EVM transaction (legacy / EIP-155, EIP-2930, EIP-1559, EIP-7702), signed or unsigned.
// Read-only: for a signed tx the sender is recovered from the signature over the re-built signing payload.

import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "../../shared/utils";
import { checksumEvmAddress } from "../review/review-format";
import { rlpBytes, rlpDecode, rlpEncodeUint, rlpUint, rlpWrapList, type RlpItem } from "./rlp-decode";

export interface DecodedEvmTx {
  /** 0 legacy, 1 EIP-2930, 2 EIP-1559, 4 EIP-7702. */
  type: 0 | 1 | 2 | 4;
  /** null: pre-EIP-155 legacy tx (valid on any chain: replayable). */
  chainId: number | null;
  nonce: bigint;
  to: string | null;
  value: bigint;
  data: string;
  gasLimit: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  accessListSize: number;
  authorizationCount: number;
  signed: boolean;
  /** Recovered sender (signed only). */
  from?: string;
  /** keccak256 of the signed bytes = the tx hash (signed only). */
  hash?: string;
  /** Fee ceiling: gasLimit × (maxFeePerGas | gasPrice). */
  maxFeeWei: bigint;
}

const hex0x = (b: Uint8Array) => `0x${bytesToHex(b)}`;

function addressOf(item: RlpItem | undefined, field: string): string | null {
  const b = rlpBytes(item, field);
  if (b.length === 0) return null;
  if (b.length !== 20) throw new Error(`Invalid transaction: bad ${field}`);
  return checksumEvmAddress(hex0x(b));
}

function listSize(item: RlpItem | undefined, field: string): number {
  if (!item || item.kind !== "list") throw new Error(`Invalid transaction: ${field} must be a list`);
  return item.items.length;
}

function chainIdOf(n: bigint): number {
  if (n === 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Invalid transaction: bad chainId");
  return Number(n);
}

function recoverSender(payload: Uint8Array, r: bigint, s: bigint, recovery: number): string {
  if (recovery !== 0 && recovery !== 1) throw new Error("Invalid transaction: bad signature v");
  const pub = new secp256k1.Signature(r, s).addRecoveryBit(recovery).recoverPublicKey(keccak_256(payload)).toBytes(false);
  return checksumEvmAddress(hex0x(keccak_256(pub.slice(1)).slice(12)));
}

function decodeLegacy(bytes: Uint8Array, items: RlpItem[]): DecodedEvmTx {
  if (items.length !== 6 && items.length !== 9) throw new Error(`Invalid legacy transaction: ${items.length} fields`);
  const base = {
    type: 0 as const, nonce: rlpUint(items[0], "nonce", 8), gasPrice: rlpUint(items[1], "gasPrice"),
    gasLimit: rlpUint(items[2], "gasLimit", 8), to: addressOf(items[3], "to"), value: rlpUint(items[4], "value"),
    data: hex0x(rlpBytes(items[5], "data")), accessListSize: 0, authorizationCount: 0,
  };
  const maxFeeWei = base.gasLimit * base.gasPrice;
  if (items.length === 6) return { ...base, chainId: null, signed: false, maxFeeWei };
  const v = rlpUint(items[6], "v", 8);
  const r = rlpUint(items[7], "r");
  const s = rlpUint(items[8], "s");
  // Unsigned EIP-155 payload: [.., chainId, 0, 0].
  if (r === 0n && s === 0n) return { ...base, chainId: chainIdOf(v), signed: false, maxFeeWei };
  const fields = items.slice(0, 6).map((i) => i.raw);
  let chainId: number | null;
  let recovery: number;
  let payload: Uint8Array;
  if (v === 27n || v === 28n) {
    chainId = null;
    recovery = Number(v - 27n);
    payload = rlpWrapList(fields);
  } else if (v >= 35n) {
    const id = (v - 35n) / 2n;
    chainId = chainIdOf(id);
    recovery = Number(v - 35n - id * 2n);
    payload = rlpWrapList([...fields, rlpEncodeUint(id), rlpEncodeUint(0n), rlpEncodeUint(0n)]);
  } else throw new Error("Invalid transaction: bad signature v");
  return { ...base, chainId, signed: true, from: recoverSender(payload, r, s, recovery), hash: hex0x(keccak_256(bytes)), maxFeeWei };
}

/** Field count before the signature for each typed envelope. */
const TYPED_FIELDS: Record<number, number> = { 1: 8, 2: 9, 4: 10 };

function decodeTyped(bytes: Uint8Array, type: 1 | 2 | 4, items: RlpItem[]): DecodedEvmTx {
  const n = TYPED_FIELDS[type];
  if (items.length !== n && items.length !== n + 3) throw new Error(`Invalid type-${type} transaction: ${items.length} fields`);
  const chainId = chainIdOf(rlpUint(items[0], "chainId", 8));
  const eip1559 = type !== 1;
  const off = eip1559 ? 1 : 0;
  const maxPriorityFeePerGas = eip1559 ? rlpUint(items[2], "maxPriorityFeePerGas") : undefined;
  const feeCap = rlpUint(items[2 + off], eip1559 ? "maxFeePerGas" : "gasPrice");
  const gasLimit = rlpUint(items[3 + off], "gasLimit", 8);
  const tx: DecodedEvmTx = {
    type, chainId, nonce: rlpUint(items[1], "nonce", 8), gasLimit,
    ...(eip1559 ? { maxFeePerGas: feeCap, maxPriorityFeePerGas } : { gasPrice: feeCap }),
    to: addressOf(items[4 + off], "to"), value: rlpUint(items[5 + off], "value"), data: hex0x(rlpBytes(items[6 + off], "data")),
    accessListSize: listSize(items[7 + off], "accessList"),
    authorizationCount: type === 4 ? listSize(items[9], "authorizationList") : 0,
    signed: false, maxFeeWei: gasLimit * feeCap,
  };
  if (type === 4 && tx.to === null) throw new Error("Invalid type-4 transaction: missing to");
  if (items.length === n) return tx;
  const yParity = rlpUint(items[n], "yParity", 1);
  const payload = new Uint8Array([type, ...rlpWrapList(items.slice(0, n).map((i) => i.raw))]);
  const from = recoverSender(payload, rlpUint(items[n + 1], "r"), rlpUint(items[n + 2], "s"), Number(yParity));
  return { ...tx, signed: true, from, hash: hex0x(keccak_256(bytes)) };
}

/** Decode raw EVM tx bytes; throws with a readable reason when they are not one. */
export function decodeEvmRawTx(bytes: Uint8Array): DecodedEvmTx {
  if (bytes.length === 0) throw new Error("Empty transaction");
  const first = bytes[0];
  if (first >= 0xc0) {
    const root = rlpDecode(bytes);
    if (root.kind !== "list") throw new Error("Invalid transaction");
    return decodeLegacy(bytes, root.items);
  }
  if (first === 3) throw new Error("Blob (type-3) transactions are not supported");
  if (first !== 1 && first !== 2 && first !== 4) throw new Error(`Unknown transaction type ${first}`);
  const root = rlpDecode(bytes.slice(1));
  if (root.kind !== "list") throw new Error("Invalid transaction");
  return decodeTyped(bytes, first, root.items);
}
