// Read-only RLP decoder for the Expert "Decode transaction" tool. Unlike the API's strict parser
// (api/src/chains/evm-tx.ts, which only accepts the flat legacy list it co-signs) this one accepts
// nested lists (access lists, EIP-7702 authorizations). Every length is bounds-checked; non-canonical
// encodings are rejected so a decoded tx always re-hashes to the bytes the user pasted.

export type RlpItem = { kind: "bytes"; data: Uint8Array; raw: Uint8Array } | { kind: "list"; items: RlpItem[]; raw: Uint8Array };

const MAX_DEPTH = 8;

function readLength(input: Uint8Array, offset: number, lenOfLen: number): number {
  if (offset + lenOfLen > input.length) throw new Error("RLP: truncated length");
  if (input[offset] === 0) throw new Error("RLP: non-canonical length");
  let len = 0;
  for (let i = 0; i < lenOfLen; i++) len = len * 256 + input[offset + i];
  if (len <= 55) throw new Error("RLP: non-canonical length");
  return len;
}

function decodeAt(input: Uint8Array, offset: number, depth: number): { item: RlpItem; next: number } {
  if (depth > MAX_DEPTH) throw new Error("RLP: nested too deep");
  if (offset >= input.length) throw new Error("RLP: truncated");
  const prefix = input[offset];
  if (prefix <= 0x7f) {
    const data = input.slice(offset, offset + 1);
    return { item: { kind: "bytes", data, raw: data }, next: offset + 1 };
  }
  const isList = prefix >= 0xc0;
  const base = isList ? 0xc0 : 0x80;
  let start: number;
  let len: number;
  if (prefix - base <= 55) {
    start = offset + 1;
    len = prefix - base;
  } else {
    const lenOfLen = prefix - base - 55;
    len = readLength(input, offset + 1, lenOfLen);
    start = offset + 1 + lenOfLen;
  }
  const end = start + len;
  if (end > input.length) throw new Error("RLP: truncated");
  const raw = input.slice(offset, end);
  if (!isList) {
    if (len === 1 && input[start] <= 0x7f) throw new Error("RLP: non-canonical single byte");
    return { item: { kind: "bytes", data: input.slice(start, end), raw }, next: end };
  }
  const items: RlpItem[] = [];
  let pos = start;
  while (pos < end) {
    const r = decodeAt(input, pos, depth + 1);
    if (r.next > end) throw new Error("RLP: item overruns list");
    items.push(r.item);
    pos = r.next;
  }
  return { item: { kind: "list", items, raw }, next: end };
}

/** Decode exactly one RLP item spanning all of `input`. */
export function rlpDecode(input: Uint8Array): RlpItem {
  if (input.length === 0) throw new Error("RLP: empty input");
  const { item, next } = decodeAt(input, 0, 0);
  if (next !== input.length) throw new Error("RLP: trailing bytes");
  return item;
}

/** List header + the already-encoded items (re-assembles a signing payload from a decoded tx). */
export function rlpWrapList(encodedItems: Uint8Array[]): Uint8Array {
  const total = encodedItems.reduce((n, b) => n + b.length, 0);
  let header: number[];
  if (total <= 55) header = [0xc0 + total];
  else {
    const lenBytes: number[] = [];
    for (let n = total; n > 0; n = Math.floor(n / 256)) lenBytes.unshift(n % 256);
    header = [0xf7 + lenBytes.length, ...lenBytes];
  }
  const out = new Uint8Array(header.length + total);
  out.set(header, 0);
  let o = header.length;
  for (const b of encodedItems) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/** Encode a canonical RLP integer (used for the EIP-155 chainId, 0, 0 tail). */
export function rlpEncodeUint(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0x80]);
  const bytes: number[] = [];
  for (let v = n; v > 0n; v >>= 8n) bytes.unshift(Number(v & 0xffn));
  if (bytes.length === 1 && bytes[0] < 0x80) return new Uint8Array(bytes);
  return new Uint8Array([0x80 + bytes.length, ...bytes]);
}

export function rlpBytes(item: RlpItem | undefined, field: string): Uint8Array {
  if (!item || item.kind !== "bytes") throw new Error(`Invalid transaction: ${field} must be a byte string`);
  return item.data;
}

/** Canonical big-endian uint (no leading zero byte), at most `maxBytes` long. */
export function rlpUint(item: RlpItem | undefined, field: string, maxBytes = 32): bigint {
  const b = rlpBytes(item, field);
  if (b.length > maxBytes || (b.length > 0 && b[0] === 0)) throw new Error(`Invalid transaction: bad ${field}`);
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}
