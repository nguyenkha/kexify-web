/**
 * Cardano transaction building, signing, and broadcasting.
 * Uses CBOR encoding and Blake2b-256 for transaction hashing.
 * Broadcasts via Koios REST API.
 */

import { blake2b } from "@noble/hashes/blake2b";
import { bech32 } from "@scure/base";

// ── Minimal CBOR encoder (Cardano canonical format) ──

function cborEncodeUint(n: number | bigint): Uint8Array {
  const v = typeof n === "bigint" ? n : BigInt(n);
  if (v < 0n) throw new Error("Negative integers not supported");
  if (v <= 23n) return new Uint8Array([Number(v)]);
  if (v <= 0xffn) return new Uint8Array([0x18, Number(v)]);
  if (v <= 0xffffn) return new Uint8Array([0x19, Number((v >> 8n) & 0xffn), Number(v & 0xffn)]);
  if (v <= 0xffffffffn) {
    const x = Number(v);
    return new Uint8Array([0x1a, (x >> 24) & 0xff, (x >> 16) & 0xff, (x >> 8) & 0xff, x & 0xff]);
  }
  // uint64
  const hi = Number((v >> 32n) & 0xffffffffn);
  const lo = Number(v & 0xffffffffn);
  return new Uint8Array([0x1b,
    (hi >> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff,
    (lo >> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff,
  ]);
}

function cborEncodeBytes(data: Uint8Array): Uint8Array {
  const header = data.length <= 23
    ? new Uint8Array([0x40 | data.length])
    : data.length <= 0xff
      ? new Uint8Array([0x58, data.length])
      : new Uint8Array([0x59, (data.length >> 8) & 0xff, data.length & 0xff]);
  const result = new Uint8Array(header.length + data.length);
  result.set(header, 0);
  result.set(data, header.length);
  return result;
}

function cborEncodeArray(items: Uint8Array[]): Uint8Array {
  const header = items.length <= 23
    ? new Uint8Array([0x80 | items.length])
    : new Uint8Array([0x98, items.length]);
  const totalLen = header.length + items.reduce((s, i) => s + i.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  result.set(header, offset); offset += header.length;
  for (const item of items) { result.set(item, offset); offset += item.length; }
  return result;
}

function cborEncodeMap(entries: [Uint8Array, Uint8Array][]): Uint8Array {
  const header = entries.length <= 23
    ? new Uint8Array([0xa0 | entries.length])
    : new Uint8Array([0xb8, entries.length]);
  const totalLen = header.length + entries.reduce((s, [k, v]) => s + k.length + v.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  result.set(header, offset); offset += header.length;
  for (const [k, v] of entries) {
    result.set(k, offset); offset += k.length;
    result.set(v, offset); offset += v.length;
  }
  return result;
}

// CBOR null
const CBOR_NULL = new Uint8Array([0xf6]);
// CBOR true
const CBOR_TRUE = new Uint8Array([0xf5]);

// ── Address utilities ──

/** Decode a bech32 Cardano address to raw bytes */
export function adaAddressToBytes(address: string): Uint8Array {
  const prefix = address.startsWith("addr_test") ? "addr_test" : "addr";
  const decoded = bech32.decode(address as `${string}1${string}`, 120);
  if (decoded.prefix !== prefix) throw new Error(`Invalid ADA address prefix: ${decoded.prefix}`);
  return new Uint8Array(bech32.fromWords(decoded.words));
}

/** Convert Ed25519 public key hex to 32-byte key */
function extractEd25519Key(hexStr: string): Uint8Array {
  const bytes = hexToBytes(hexStr);
  if (bytes.length === 32) return bytes;
  if (bytes.length === 65 && bytes[0] === 0x04) {
    const xBe = bytes.slice(1, 33);
    const yLe = bytes.slice(33).reverse();
    const key32 = new Uint8Array(yLe);
    key32[31] = (key32[31] & 0x7f) | ((xBe[31] & 1) << 7);
    return key32;
  }
  throw new Error(`Expected 32 or 65-byte Ed25519 key, got ${bytes.length}`);
}

export function eddsaPubKeyToAdaAddress(eddsaPubKeyHex: string, testnet = false): string {
  const key32 = extractEd25519Key(eddsaPubKeyHex);
  const keyHash = blake2b(key32, { dkLen: 28 });
  const header = testnet ? 0x60 : 0x61;
  const payload = new Uint8Array(29);
  payload[0] = header;
  payload.set(keyHash, 1);
  const prefix = testnet ? "addr_test" : "addr";
  return bech32.encode(prefix, bech32.toWords(payload));
}

// ── UTXO types ──

export interface CardanoUtxo {
  txHash: string;
  txIndex: number;
  value: string; // lovelace as string
}

// ── Tatum Rosetta API helpers (rate-limited: 5 req/min) ──

// Sequential queue to respect Tatum free tier rate limit
let adaTxApiQueue: Promise<void> = Promise.resolve();

function adaTxQueuedFetch(url: string, body: object): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    adaTxApiQueue = adaTxApiQueue.then(async () => {
      try {
        resolve(await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
      } catch (err) {
        reject(err);
      }
      await new Promise((r) => setTimeout(r, 13_000)); // 13s between requests
    });
  });
}

function rosettaNetworkId(rpcUrl: string): { blockchain: string; network: string } {
  return {
    blockchain: "cardano",
    network: rpcUrl.includes("preprod") ? "preprod" : "mainnet",
  };
}

/** Fetch UTXOs for an address via Rosetta /account/coins */
export async function getAdaUtxos(rpcUrl: string, address: string): Promise<CardanoUtxo[]> {
  const res = await adaTxQueuedFetch(`${rpcUrl}/account/coins`, {
    network_identifier: rosettaNetworkId(rpcUrl),
    account_identifier: { address },
    include_mempool: false,
  });
  if (!res.ok) throw new Error(`Failed to fetch ADA UTXOs: ${res.status}`);
  const data = await res.json();
  return (data.coins ?? []).map((coin: {
    coin_identifier: { identifier: string };
    amount: { value: string };
  }) => {
    // coin_identifier.identifier = "txHash:index"
    const [txHash, txIndex] = coin.coin_identifier.identifier.split(":");
    return {
      txHash,
      txIndex: parseInt(txIndex, 10),
      value: coin.amount.value,
    };
  });
}

/** Get current tip for TTL calculation via Rosetta /network/status */
export async function getAdaTip(rpcUrl: string): Promise<{ slot: number; blockHeight: number }> {
  const res = await adaTxQueuedFetch(`${rpcUrl}/network/status`, {
    network_identifier: rosettaNetworkId(rpcUrl),
  });
  if (!res.ok) throw new Error(`Failed to fetch ADA tip: ${res.status}`);
  const data = await res.json();
  // Rosetta provides block index; use index * 20 as approximate slot (Cardano ~20s slots)
  // For TTL we just need a rough future value
  const blockHeight = data.current_block_identifier?.index ?? 0;
  return { slot: blockHeight * 20, blockHeight };
}

/** Get protocol parameters — use hardcoded Cardano mainnet values (stable across epochs) */
export async function getAdaProtocolParams(_rpcUrl: string): Promise<{ minFeeA: number; minFeeB: number; minUtxoValue: bigint }> {
  // Cardano protocol params are stable; hardcode current mainnet values
  // minFeeA = 44 lovelace per byte, minFeeB = 155381 lovelace base fee
  return {
    minFeeA: 44,
    minFeeB: 155381,
    minUtxoValue: 1_000_000n, // 1 ADA minimum UTXO
  };
}

// ── Transaction building ──

/** Select UTXOs that cover the required amount + estimated fee */
function selectUtxos(utxos: CardanoUtxo[], requiredLovelace: bigint): { selected: CardanoUtxo[]; total: bigint } {
  // Sort descending by value for greedy selection
  const sorted = [...utxos].sort((a, b) => {
    const va = BigInt(a.value), vb = BigInt(b.value);
    return va > vb ? -1 : va < vb ? 1 : 0;
  });
  const selected: CardanoUtxo[] = [];
  let total = 0n;
  for (const utxo of sorted) {
    selected.push(utxo);
    total += BigInt(utxo.value);
    if (total >= requiredLovelace) break;
  }
  if (total < requiredLovelace) throw new Error("Insufficient ADA balance");
  return { selected, total };
}

/** Build a CBOR-encoded Cardano transaction body */
export function buildAdaPaymentTx(
  inputs: { txHash: string; txIndex: number }[],
  toAddress: string,
  amount: bigint,
  changeAddress: string,
  fee: bigint,
  ttl: number,
  changeAmount: bigint,
): Uint8Array {
  // Transaction body is a CBOR map:
  // 0 -> inputs (set of [tx_hash, index])
  // 1 -> outputs (array of [address, amount])
  // 2 -> fee
  // 3 -> ttl

  // Inputs: CBOR array of [bytes(32), uint]
  const cborInputs = inputs.map((inp) => {
    const hashBytes = hexToBytes(inp.txHash);
    return cborEncodeArray([cborEncodeBytes(hashBytes), cborEncodeUint(inp.txIndex)]);
  });

  // Outputs
  const toAddrBytes = adaAddressToBytes(toAddress);
  const changeAddrBytes = adaAddressToBytes(changeAddress);

  const outputs: Uint8Array[] = [
    cborEncodeArray([cborEncodeBytes(toAddrBytes), cborEncodeUint(amount)]),
  ];
  if (changeAmount > 0n) {
    outputs.push(cborEncodeArray([cborEncodeBytes(changeAddrBytes), cborEncodeUint(changeAmount)]));
  }

  // Build body map (keys must be in canonical order: 0, 1, 2, 3)
  const bodyEntries: [Uint8Array, Uint8Array][] = [
    [cborEncodeUint(0), cborEncodeArray(cborInputs)],    // inputs
    [cborEncodeUint(1), cborEncodeArray(outputs)],        // outputs
    [cborEncodeUint(2), cborEncodeUint(fee)],             // fee
    [cborEncodeUint(3), cborEncodeUint(ttl)],             // ttl
  ];

  return cborEncodeMap(bodyEntries);
}

/** Calculate fee: fee = minFeeA * txSize + minFeeB */
export function calculateFee(txSizeEstimate: number, minFeeA: number, minFeeB: number): bigint {
  return BigInt(minFeeA) * BigInt(txSizeEstimate) + BigInt(minFeeB);
}

/** Hash a transaction body for signing (Blake2b-256) */
export function hashTxBody(txBodyCbor: Uint8Array): Uint8Array {
  return blake2b(txBodyCbor, { dkLen: 32 });
}

/** Assemble a full signed Cardano transaction */
export function assembleAdaSignedTx(txBodyCbor: Uint8Array, vkey: Uint8Array, signature: Uint8Array): Uint8Array {
  // Full transaction: [body, witnessSet, isValid, auxiliaryData]
  // witnessSet: {0: [[vkey, sig]]}
  const witnessEntry = cborEncodeArray([cborEncodeBytes(vkey), cborEncodeBytes(signature)]);
  const witnessSet = cborEncodeMap([
    [cborEncodeUint(0), cborEncodeArray([witnessEntry])],
  ]);

  return cborEncodeArray([txBodyCbor, witnessSet, CBOR_TRUE, CBOR_NULL]);
}

/** Broadcast a signed transaction directly via Koios (CORS supported on /submittx) */
export async function broadcastAdaTransaction(rpcUrl: string, signedTxCbor: Uint8Array): Promise<string> {
  const koiosUrl = rpcUrl.includes("preprod")
    ? "https://preprod.koios.rest/api/v1/submittx"
    : "https://api.koios.rest/api/v1/submittx";
  const res = await fetch(koiosUrl, {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: signedTxCbor as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ADA broadcast failed: ${text}`);
  }
  const txHash = await res.text();
  return txHash.replace(/"/g, "").trim();
}

/** Poll for transaction confirmation via Rosetta /search/transactions */
export async function waitForAdaConfirmation(
  rpcUrl: string,
  txHash: string,
  maxAttempts = 10,
  intervalMs = 15000,
): Promise<{ confirmed: boolean; blockHeight: number }> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await adaTxQueuedFetch(`${rpcUrl}/search/transactions`, {
      network_identifier: rosettaNetworkId(rpcUrl),
      transaction_identifier: { hash: txHash },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.transactions?.length > 0) {
        const blockHeight = data.transactions[0].block_identifier?.index ?? 0;
        return { confirmed: true, blockHeight };
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { confirmed: false, blockHeight: 0 };
}

/**
 * High-level: build a payment transaction with automatic UTXO selection and fee estimation.
 * Returns the CBOR-encoded tx body ready for signing.
 */
export async function prepareAdaPaymentTx(
  rpcUrl: string,
  fromAddress: string,
  toAddress: string,
  amountLovelace: bigint,
): Promise<{ txBody: Uint8Array; fee: bigint }> {
  // Cardano requires minimum ~1 ADA per output
  if (amountLovelace < 1_000_000n) {
    throw new Error("Minimum send amount is 1 ADA");
  }

  // 1. Fetch UTXOs and protocol params
  const [utxos, tip, params] = await Promise.all([
    getAdaUtxos(rpcUrl, fromAddress),
    getAdaTip(rpcUrl),
    getAdaProtocolParams(rpcUrl),
  ]);

  const ttl = tip.slot + 7200; // ~2 hours from now

  // 2. Estimate fee with a dummy tx (2 inputs, 2 outputs ≈ 300 bytes)
  const estimatedFee = calculateFee(300, params.minFeeA, params.minFeeB);

  // 3. Select UTXOs
  const totalNeeded = amountLovelace + estimatedFee;
  const { selected, total } = selectUtxos(utxos, totalNeeded);

  // 4. Calculate change
  let change = total - amountLovelace - estimatedFee;

  // 5. Build tx body to get actual size
  const inputs = selected.map((u) => ({ txHash: u.txHash, txIndex: u.txIndex }));
  let txBody = buildAdaPaymentTx(inputs, toAddress, amountLovelace, fromAddress, estimatedFee, ttl, change);

  // 6. Recalculate fee with actual tx size (add ~150 bytes for witness overhead)
  const actualFee = calculateFee(txBody.length + 150, params.minFeeA, params.minFeeB);

  // 7. Rebuild if fee changed significantly
  if (actualFee > estimatedFee) {
    change = total - amountLovelace - actualFee;
    if (change < 0n) throw new Error("Insufficient ADA after fee recalculation");
    // If change is below minimum UTXO value, absorb it into fee
    if (change > 0n && change < params.minUtxoValue) {
      const adjustedFee = actualFee + change;
      change = 0n;
      txBody = buildAdaPaymentTx(inputs, toAddress, amountLovelace, fromAddress, adjustedFee, ttl, change);
      return { txBody, fee: adjustedFee };
    }
    txBody = buildAdaPaymentTx(inputs, toAddress, amountLovelace, fromAddress, actualFee, ttl, change);
    return { txBody, fee: actualFee };
  }

  return { txBody, fee: estimatedFee };
}

// ── Utilities ──

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export { extractEd25519Key, hexToBytes, bytesToHex };
