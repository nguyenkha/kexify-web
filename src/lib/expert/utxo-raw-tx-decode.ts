// Decode a raw Bitcoin-family transaction (legacy or segwit) or a BIP-174 PSBT (v0) for display.
// Input amounts are known only from a PSBT's witness_utxo / non_witness_utxo; the fee is shown only
// when every input amount is known. Read-only: nothing here signs or finalizes.

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "../../shared/utils";
import { scriptToAddress, type UtxoNetwork } from "./utxo-script-address";

export interface UtxoInput {
  txid: string;
  vout: number;
  sequence: number;
  /** Known from the PSBT only. */
  value?: bigint;
  address?: string | null;
  signed: boolean;
}

export interface UtxoOutput {
  value: bigint;
  script: string;
  address: string | null;
}

export interface DecodedUtxoTx {
  format: "raw" | "psbt";
  version: number;
  locktime: number;
  segwit: boolean;
  inputs: UtxoInput[];
  outputs: UtxoOutput[];
  /** Sum of inputs − outputs when every input amount is known. */
  fee: bigint | null;
  /** Raw signed tx only (PSBT: id of its unsigned tx). */
  txid: string;
}

class Reader {
  o = 0;
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  need(n: number) {
    if (this.o + n > this.b.length) throw new Error("Transaction is truncated");
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    return this.b.slice(this.o, (this.o += n));
  }
  u8(): number {
    this.need(1);
    return this.b[this.o++];
  }
  u32(): number {
    const x = this.bytes(4);
    return (x[0] | (x[1] << 8) | (x[2] << 16) | (x[3] << 24)) >>> 0;
  }
  u64(): bigint {
    const x = this.bytes(8);
    let n = 0n;
    for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(x[i]);
    return n;
  }
  varint(): number {
    const f = this.u8();
    if (f < 0xfd) return f;
    if (f === 0xfd) return this.bytes(2).reduce((n, x, i) => n + x * 256 ** i, 0);
    if (f === 0xfe) return this.u32();
    const n = this.u64();
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Varint too large");
    return Number(n);
  }
  done() {
    return this.o >= this.b.length;
  }
}

const reverseHex = (b: Uint8Array) => bytesToHex(Uint8Array.from(b).reverse());
const MAX_ITEMS = 10_000;

interface ParsedTx {
  version: number;
  locktime: number;
  segwit: boolean;
  inputs: { txid: string; vout: number; sequence: number; scriptSig: Uint8Array; witness: number }[];
  outputs: { value: bigint; script: Uint8Array }[];
  /** Serialization without witness data (the txid preimage). */
  stripped: Uint8Array;
}

function parseTx(bytes: Uint8Array, allowTrailing = false): { tx: ParsedTx; end: number } {
  const r = new Reader(bytes);
  const version = r.u32();
  const versionEnd = r.o;
  let segwit = false;
  if (r.b[r.o] === 0x00 && r.b[r.o + 1] === 0x01) {
    segwit = true;
    r.o += 2;
  }
  const insStart = r.o;
  const nIn = r.varint();
  if (nIn > MAX_ITEMS) throw new Error("Too many inputs");
  const inputs: ParsedTx["inputs"] = [];
  for (let i = 0; i < nIn; i++) {
    const txid = reverseHex(r.bytes(32));
    const vout = r.u32();
    const scriptSig = r.bytes(r.varint());
    inputs.push({ txid, vout, scriptSig, sequence: r.u32(), witness: 0 });
  }
  const nOut = r.varint();
  if (nOut > MAX_ITEMS) throw new Error("Too many outputs");
  const outputs: ParsedTx["outputs"] = [];
  for (let i = 0; i < nOut; i++) outputs.push({ value: r.u64(), script: r.bytes(r.varint()) });
  const outsEnd = r.o;
  if (segwit) {
    for (const input of inputs) {
      const n = r.varint();
      for (let k = 0; k < n; k++) r.bytes(r.varint());
      input.witness = n;
    }
  }
  const lockStart = r.o;
  const locktime = r.u32();
  if (!allowTrailing && !r.done()) throw new Error("Trailing bytes after transaction");
  const stripped = new Uint8Array([...bytes.slice(0, versionEnd), ...bytes.slice(insStart, outsEnd), ...bytes.slice(lockStart, r.o)]);
  return { tx: { version, locktime, segwit, inputs, outputs, stripped }, end: r.o };
}

const txidOf = (stripped: Uint8Array) => reverseHex(sha256(sha256(stripped)));

function summarize(tx: ParsedTx, format: "raw" | "psbt", network: UtxoNetwork, prev: (UtxoInput["value"] | null)[], prevScripts: (Uint8Array | null)[], signedPsbt: boolean[]): DecodedUtxoTx {
  const inputs = tx.inputs.map((i, k): UtxoInput => ({
    txid: i.txid, vout: i.vout, sequence: i.sequence,
    value: prev[k] ?? undefined,
    address: prevScripts[k] ? scriptToAddress(prevScripts[k]!, network) : undefined,
    signed: format === "raw" ? i.scriptSig.length > 0 || i.witness > 0 : signedPsbt[k],
  }));
  const outputs = tx.outputs.map((o) => ({ value: o.value, script: bytesToHex(o.script), address: scriptToAddress(o.script, network) }));
  const known = inputs.every((i) => i.value !== undefined) && inputs.length > 0;
  const fee = known ? inputs.reduce((s, i) => s + i.value!, 0n) - outputs.reduce((s, o) => s + o.value, 0n) : null;
  return { format, version: tx.version, locktime: tx.locktime, segwit: tx.segwit, inputs, outputs, fee, txid: txidOf(tx.stripped) };
}

export function decodeUtxoRawTx(bytes: Uint8Array, network: UtxoNetwork): DecodedUtxoTx {
  const { tx } = parseTx(bytes);
  if (tx.inputs.length === 0 || tx.outputs.length === 0) throw new Error("Not a Bitcoin-style transaction");
  return summarize(tx, "raw", network, [], [], []);
}

export const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

/** Key-value map until the 0x00 separator. */
function readMap(r: Reader): { key: Uint8Array; value: Uint8Array }[] {
  const out: { key: Uint8Array; value: Uint8Array }[] = [];
  for (;;) {
    const klen = r.varint();
    if (klen === 0) return out;
    if (out.length > MAX_ITEMS) throw new Error("PSBT map too large");
    const key = r.bytes(klen);
    out.push({ key, value: r.bytes(r.varint()) });
  }
}

export function decodePsbt(bytes: Uint8Array, network: UtxoNetwork): DecodedUtxoTx {
  if (!PSBT_MAGIC.every((b, i) => bytes[i] === b)) throw new Error("Not a PSBT");
  const r = new Reader(bytes);
  r.o = PSBT_MAGIC.length;
  const global = readMap(r);
  const unsigned = global.find((e) => e.key.length === 1 && e.key[0] === 0x00);
  if (!unsigned) throw new Error("PSBT v2 is not supported (no unsigned transaction)");
  const { tx } = parseTx(unsigned.value);
  const values: (bigint | null)[] = [];
  const scripts: (Uint8Array | null)[] = [];
  const signed: boolean[] = [];
  for (const input of tx.inputs) {
    const map = readMap(r);
    let value: bigint | null = null;
    let script: Uint8Array | null = null;
    const witnessUtxo = map.find((e) => e.key[0] === 0x01 && e.key.length === 1);
    const nonWitness = map.find((e) => e.key[0] === 0x00 && e.key.length === 1);
    if (nonWitness) {
      const prev = parseTx(nonWitness.value).tx;
      // The full previous tx must be the one this input spends (BIP-174), or its amount means nothing.
      if (txidOf(prev.stripped) !== input.txid) throw new Error("PSBT previous transaction does not match its input");
      const out = prev.outputs[input.vout];
      if (!out) throw new Error("PSBT input spends a missing output");
      value = out.value;
      script = out.script;
    } else if (witnessUtxo) {
      const wr = new Reader(witnessUtxo.value);
      value = wr.u64();
      script = wr.bytes(wr.varint());
    }
    values.push(value);
    scripts.push(script);
    // Partial sigs (0x02), final scriptSig (0x07) or final witness (0x08), taproot key sig (0x13).
    signed.push(map.some((e) => [0x02, 0x07, 0x08, 0x13].includes(e.key[0])));
  }
  for (let i = 0; i < tx.outputs.length; i++) readMap(r);
  return summarize(tx, "psbt", network, values, scripts, signed);
}
