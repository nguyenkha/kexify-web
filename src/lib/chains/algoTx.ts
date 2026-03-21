/**
 * Algorand transaction building, signing, and broadcasting.
 * Uses msgpack encoding and SHA-512/256 for transaction hashing.
 */

import { sha512_256 } from "@noble/hashes/sha2";

// ── Minimal msgpack encoder (Algorand canonical format) ──

function encodeMsgpack(obj: Record<string, unknown>): Uint8Array {
  const parts: Uint8Array[] = [];

  function writeValue(val: unknown): void {
    if (val === null || val === undefined) return; // skip nil in Algorand canonical

    if (typeof val === "number") {
      if (Number.isInteger(val) && val >= 0) {
        if (val <= 0x7f) { parts.push(new Uint8Array([val])); }
        else if (val <= 0xff) { parts.push(new Uint8Array([0xcc, val])); }
        else if (val <= 0xffff) { parts.push(new Uint8Array([0xcd, (val >> 8) & 0xff, val & 0xff])); }
        else { parts.push(new Uint8Array([0xce, (val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff])); }
      }
      return;
    }

    if (typeof val === "bigint") {
      if (val <= 0x7fn) { parts.push(new Uint8Array([Number(val)])); }
      else if (val <= 0xffn) { parts.push(new Uint8Array([0xcc, Number(val)])); }
      else if (val <= 0xffffn) { parts.push(new Uint8Array([0xcd, Number((val >> 8n) & 0xffn), Number(val & 0xffn)])); }
      else if (val <= 0xffffffffn) {
        const n = Number(val);
        parts.push(new Uint8Array([0xce, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]));
      } else {
        // uint64
        const hi = Number((val >> 32n) & 0xffffffffn);
        const lo = Number(val & 0xffffffffn);
        parts.push(new Uint8Array([0xcf,
          (hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
          (lo >> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff]));
      }
      return;
    }

    if (typeof val === "string") {
      const encoded = new TextEncoder().encode(val);
      if (encoded.length <= 31) { parts.push(new Uint8Array([0xa0 | encoded.length])); }
      else if (encoded.length <= 0xff) { parts.push(new Uint8Array([0xd9, encoded.length])); }
      else { parts.push(new Uint8Array([0xda, (encoded.length >> 8) & 0xff, encoded.length & 0xff])); }
      parts.push(encoded);
      return;
    }

    if (val instanceof Uint8Array) {
      if (val.length <= 0xff) { parts.push(new Uint8Array([0xc4, val.length])); }
      else { parts.push(new Uint8Array([0xc5, (val.length >> 8) & 0xff, val.length & 0xff])); }
      parts.push(val);
      return;
    }

    if (typeof val === "boolean") {
      parts.push(new Uint8Array([val ? 0xc3 : 0xc2]));
      return;
    }

    if (typeof val === "object" && val !== null) {
      writeMap(val as Record<string, unknown>);
      return;
    }
  }

  function writeMap(map: Record<string, unknown>): void {
    // Algorand canonical: sorted keys, skip zero/empty/null values
    const entries = Object.entries(map)
      .filter(([, v]) => v !== null && v !== undefined && v !== 0 && v !== 0n && v !== "")
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

    const len = entries.length;
    if (len <= 15) { parts.push(new Uint8Array([0x80 | len])); }
    else { parts.push(new Uint8Array([0xde, (len >> 8) & 0xff, len & 0xff])); }

    for (const [key, val] of entries) {
      writeValue(key);
      writeValue(val);
    }
  }

  writeMap(obj);

  // Concatenate all parts
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return result;
}

// ── Transaction types ──

export interface AlgoSuggestedParams {
  fee: number;
  firstRound: number;
  lastRound: number;
  genesisId: string;
  genesisHash: Uint8Array;
}

/** Fetch suggested params from Algod */
export async function getAlgoSuggestedParams(rpcUrl: string): Promise<AlgoSuggestedParams> {
  const res = await fetch(`${rpcUrl}/v2/transactions/params`);
  if (!res.ok) throw new Error(`Failed to fetch ALGO params: ${res.status}`);
  const data = await res.json();
  return {
    fee: Math.max(data["min-fee"] ?? 1000, 1000),
    firstRound: data["last-round"],
    lastRound: data["last-round"] + 1000,
    genesisId: data["genesis-id"],
    genesisHash: Uint8Array.from(atob(data["genesis-hash"]), c => c.charCodeAt(0)),
  };
}

/** Build a payment transaction (native ALGO) */
export function buildAlgoPaymentTx(
  from: Uint8Array, to: Uint8Array, amount: bigint, params: AlgoSuggestedParams, note?: Uint8Array,
): Uint8Array {
  const txn: Record<string, unknown> = {
    type: "pay",
    snd: from,
    rcv: to,
    amt: amount,
    fee: params.fee,
    fv: params.firstRound,
    lv: params.lastRound,
    gen: params.genesisId,
    gh: params.genesisHash,
  };
  if (note && note.length > 0) txn.note = note;
  return encodeMsgpack(txn);
}

/** Build an ASA transfer transaction */
export function buildAlgoAssetTransferTx(
  from: Uint8Array, to: Uint8Array, assetId: number, amount: bigint, params: AlgoSuggestedParams,
): Uint8Array {
  const txn: Record<string, unknown> = {
    type: "axfer",
    snd: from,
    arcv: to,
    xaid: assetId,
    aamt: amount,
    fee: params.fee,
    fv: params.firstRound,
    lv: params.lastRound,
    gen: params.genesisId,
    gh: params.genesisHash,
  };
  return encodeMsgpack(txn);
}

/** Build an ASA opt-in transaction (0-amount self-transfer) */
export function buildAlgoAssetOptInTx(
  address: Uint8Array, assetId: number, params: AlgoSuggestedParams,
): Uint8Array {
  return buildAlgoAssetTransferTx(address, address, assetId, 0n, params);
}

/** Compute the signing hash: SHA-512/256("TX" + msgpack(txn)) */
export function algoHashForSigning(txBytes: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode("TX");
  const hashInput = new Uint8Array(prefix.length + txBytes.length);
  hashInput.set(prefix, 0);
  hashInput.set(txBytes, prefix.length);
  return sha512_256(hashInput);
}

/** Assemble a signed transaction (msgpack: { sig, txn }) */
export function assembleAlgoSignedTx(txBytes: Uint8Array, signature: Uint8Array): Uint8Array {
  // Decode the original txn object and wrap with sig
  // Algorand signed tx format: { sig: 64-byte Ed25519 sig, txn: { ...original fields } }
  // We re-encode as msgpack with 2 keys: sig + txn (raw bytes are the txn map)
  const parts: Uint8Array[] = [];

  // Map with 2 entries
  parts.push(new Uint8Array([0x82])); // fixmap(2)

  // "sig" key
  const sigKey = new TextEncoder().encode("sig");
  parts.push(new Uint8Array([0xa3])); // fixstr(3)
  parts.push(sigKey);
  // sig value (bin 8, 64 bytes)
  parts.push(new Uint8Array([0xc4, 64]));
  parts.push(signature);

  // "txn" key
  const txnKey = new TextEncoder().encode("txn");
  parts.push(new Uint8Array([0xa3])); // fixstr(3)
  parts.push(txnKey);
  // txn value = the original msgpack map (txBytes IS the map)
  parts.push(txBytes);

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) { result.set(p, offset); offset += p.length; }
  return result;
}

/** Broadcast a signed transaction to Algod */
export async function broadcastAlgoTransaction(rpcUrl: string, signedTx: Uint8Array): Promise<string> {
  const res = await fetch(`${rpcUrl}/v2/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-binary" },
    body: signedTx as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ALGO broadcast failed: ${text}`);
  }
  const data = await res.json();
  return data.txId as string;
}

/** Poll for transaction confirmation */
export async function waitForAlgoConfirmation(
  rpcUrl: string,
  txId: string,
  onPoll?: () => void,
  maxAttempts = 30,
  intervalMs = 3000,
): Promise<{ confirmed: boolean; round: number }> {
  for (let i = 0; i < maxAttempts; i++) {
    onPoll?.();
    const res = await fetch(`${rpcUrl}/v2/transactions/pending/${txId}`);
    if (res.ok) {
      const data = await res.json();
      if (data["confirmed-round"] && data["confirmed-round"] > 0) {
        return { confirmed: true, round: data["confirmed-round"] };
      }
      if (data["pool-error"]) throw new Error(`ALGO tx failed: ${data["pool-error"]}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return { confirmed: false, round: 0 };
}

/** Check if an account has opted into an ASA */
export async function checkAlgoAssetOptIn(rpcUrl: string, address: string, assetId: number): Promise<boolean> {
  const res = await fetch(`${rpcUrl}/v2/accounts/${address}`);
  if (!res.ok) return false;
  const data = await res.json();
  const assets: { "asset-id": number }[] = data.assets ?? [];
  return assets.some(a => a["asset-id"] === assetId);
}

// ── Address utilities ──

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode a 58-char Algorand address to 32-byte public key */
export function algoAddressToPublicKey(address: string): Uint8Array {
  let bits = 0, value = 0;
  const output: number[] = [];
  for (const char of address) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  // First 32 bytes = public key, last 4 = checksum
  return new Uint8Array(output.slice(0, 32));
}

/** Convert Ed25519 public key hex to Algorand address */
export function eddsaPubKeyToAlgoAddress(eddsaPubKeyHex: string): string {
  const bytes = hexToBytes(eddsaPubKeyHex);
  let key32: Uint8Array;
  if (bytes.length === 32) {
    key32 = bytes;
  } else if (bytes.length === 65 && bytes[0] === 0x04) {
    const xBe = bytes.slice(1, 33);
    const yLe = bytes.slice(33).reverse();
    key32 = new Uint8Array(yLe);
    key32[31] = (key32[31] & 0x7f) | ((xBe[31] & 1) << 7);
  } else {
    throw new Error(`Expected 32 or 65-byte Ed25519 key, got ${bytes.length}`);
  }
  const hash = sha512_256(key32);
  const checksum = hash.slice(28);
  const addrBytes = new Uint8Array(36);
  addrBytes.set(key32, 0);
  addrBytes.set(checksum, 32);
  return base32Encode(addrBytes);
}

function base32Encode(data: Uint8Array): string {
  let bits = 0, value = 0, output = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
