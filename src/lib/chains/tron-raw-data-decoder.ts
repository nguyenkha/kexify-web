// Reads TRON Transaction.raw (the protobuf bytes whose SHA-256 is signed) for the WalletConnect approval sheet.
// Same accepted shapes and field rules as the API's strict parser (api/src/chains/tron-raw-data-parser.ts), so the
// sheet shows exactly what the server will judge: one TRX transfer, or one TRC-20 transfer / approve. Anything else
// throws and the request cannot be signed. tron-raw-data-decoder.test.ts checks both parsers agree on the same bytes.

import { sha256 } from "@noble/hashes/sha256";
import { base58check } from "@scure/base";
import { bytesToHex } from "../../shared/utils";

const b58check = base58check(sha256);

const TRANSFER_CONTRACT = 1;
const TRIGGER_SMART_CONTRACT = 31;
const SEL_TRANSFER = "a9059cbb";
const SEL_APPROVE = "095ea7b3";
const MAX_UINT256 = (1n << 256n) - 1n;

export interface TronDecodedTx {
  kind: "trx_transfer" | "trc20_transfer" | "trc20_approve";
  owner: string;
  /** Recipient of a transfer; the spender of a trc20_approve. */
  to: string;
  /** Sun for TRX, token base units for TRC-20 (the allowance for an approve). */
  amount: bigint;
  contractAddress: string | null;
  /** trc20_approve of max uint256. */
  unlimited: boolean;
  /** raw_data.fee_limit in sun (0 when absent). */
  feeLimit: bigint;
}

type Field = { num: number; wire: number; varint?: bigint; bytes?: Uint8Array };

function readFields(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  const readVarint = (): bigint => {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (pos >= buf.length) throw new Error("TRON raw_data: truncated varint");
      const b = buf[pos++];
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result;
    }
    throw new Error("TRON raw_data: varint too long");
  };
  while (pos < buf.length) {
    const key = readVarint();
    const num = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (num === 0) throw new Error("TRON raw_data: invalid field number");
    if (wire === 0) {
      fields.push({ num, wire, varint: readVarint() });
    } else if (wire === 2) {
      const len = Number(readVarint());
      if (pos + len > buf.length) throw new Error("TRON raw_data: truncated field");
      fields.push({ num, wire, bytes: buf.slice(pos, pos + len) });
      pos += len;
    } else {
      throw new Error(`TRON raw_data: unsupported wire type ${wire}`);
    }
  }
  return fields;
}

/** Index fields by number, rejecting unknown, repeated or wrongly typed ones (as the API does). */
function indexFields(fields: Field[], allowed: Record<number, 0 | 2>, where: string): Map<number, Field> {
  const map = new Map<number, Field>();
  for (const f of fields) {
    const wire = allowed[f.num];
    if (wire === undefined) throw new Error(`TRON ${where}: unsupported field ${f.num}`);
    if (wire !== f.wire) throw new Error(`TRON ${where}: field ${f.num} has wrong wire type`);
    if (map.has(f.num)) throw new Error(`TRON ${where}: repeated field ${f.num}`);
    map.set(f.num, f);
  }
  return map;
}

function address(bytes: Uint8Array | undefined, where: string): string {
  if (!bytes || bytes.length !== 21 || bytes[0] !== 0x41) throw new Error(`TRON ${where}: invalid address`);
  return b58check.encode(bytes);
}

const varintOf = (map: Map<number, Field>, num: number): bigint => map.get(num)?.varint ?? 0n;

/** Decode raw_data bytes into the single transfer / approval they encode; throws on anything else. */
export function decodeTronRawData(raw: Uint8Array): TronDecodedTx {
  const top = readFields(raw);
  const contracts = top.filter((f) => f.num === 11);
  if (contracts.length !== 1) throw new Error(`TRON raw_data: expected exactly 1 contract, got ${contracts.length}`);
  const feeLimit = varintOf(indexFields(top, { 1: 2, 3: 0, 4: 2, 8: 0, 10: 2, 11: 2, 14: 0, 18: 0 }, "raw_data"), 18);

  const contract = indexFields(readFields(contracts[0].bytes!), { 1: 0, 2: 2, 5: 0 }, "contract");
  if (varintOf(contract, 5) !== 0n) throw new Error("TRON contract: non-default Permission_id is not supported");
  const type = Number(varintOf(contract, 1));
  const anyBytes = contract.get(2)?.bytes;
  if (!anyBytes) throw new Error("TRON contract: missing parameter");
  const any = indexFields(readFields(anyBytes), { 1: 2, 2: 2 }, "parameter");
  const typeUrl = new TextDecoder().decode(any.get(1)?.bytes ?? new Uint8Array());
  const value = any.get(2)?.bytes ?? new Uint8Array();

  if (type === TRANSFER_CONTRACT) {
    if (typeUrl !== "type.googleapis.com/protocol.TransferContract") throw new Error("TRON contract: type_url mismatch");
    const p = indexFields(readFields(value), { 1: 2, 2: 2, 3: 0 }, "TransferContract");
    const amount = varintOf(p, 3);
    if (amount <= 0n || amount >= 1n << 63n) throw new Error("TRON TransferContract: invalid amount");
    return {
      kind: "trx_transfer", owner: address(p.get(1)?.bytes, "owner_address"), to: address(p.get(2)?.bytes, "to_address"),
      amount, contractAddress: null, unlimited: false, feeLimit,
    };
  }

  if (type === TRIGGER_SMART_CONTRACT) {
    if (typeUrl !== "type.googleapis.com/protocol.TriggerSmartContract") throw new Error("TRON contract: type_url mismatch");
    const p = indexFields(readFields(value), { 1: 2, 2: 2, 3: 0, 4: 2, 5: 0, 6: 0 }, "TriggerSmartContract");
    if (varintOf(p, 3) !== 0n || varintOf(p, 5) !== 0n || varintOf(p, 6) !== 0n) {
      throw new Error("TRON TriggerSmartContract: call_value / token value not supported");
    }
    const data = p.get(4)?.bytes;
    const selector = data && data.length >= 4 ? bytesToHex(data.slice(0, 4)) : "";
    if (!data || data.length !== 68 || (selector !== SEL_TRANSFER && selector !== SEL_APPROVE)) {
      throw new Error("TRON TriggerSmartContract: only TRC-20 transfer or approve is supported");
    }
    const word = data.slice(4, 36);
    if (word.slice(0, 12).some((b) => b !== 0)) throw new Error("TRON TRC-20: invalid address word");
    const to = new Uint8Array(21);
    to[0] = 0x41;
    to.set(word.slice(12), 1);
    const amount = BigInt("0x" + bytesToHex(data.slice(36, 68)));
    const approve = selector === SEL_APPROVE;
    return {
      kind: approve ? "trc20_approve" : "trc20_transfer",
      owner: address(p.get(1)?.bytes, "owner_address"),
      to: b58check.encode(to),
      amount,
      contractAddress: address(p.get(2)?.bytes, "contract_address"),
      unlimited: approve && amount === MAX_UINT256,
      feeLimit,
    };
  }

  throw new Error(`TRON contract type ${type} is not supported`);
}
