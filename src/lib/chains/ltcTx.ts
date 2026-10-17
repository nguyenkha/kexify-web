// Litecoin transaction support — reuses BTC UTXO/sighash logic with LTC-specific
// address formats and API endpoints (mempool-compatible Litecoin explorer).

import { sha256 } from "@noble/hashes/sha256";
import { base58check } from "@scure/base";
import { decodeSegwitAddress, segwitScriptPubKey } from "./segwit-address";
import { BlockbookNodeVerdict, LTC_ESPLORA_MAINNET, blockbookBroadcast, blockbookTxHeight, blockbookUtxos, ltcBlockbookFor, rawTxid } from "./ltc-blockbook";

const b58check = base58check(sha256);

// Re-export shared BTC primitives that are identical for LTC
export {
  type UTXO,
  type BtcInput as LtcInput,
  type BtcOutput as LtcOutput,
  type BtcUnsignedTx as LtcUnsignedTx,
  type FeeRates,
  type BtcAddressType as LtcAddressType,
  estimateVBytes,
  estimateLegacyBytes,
  estimateFee,
  selectUtxos,
  bip143Sighash,
  legacySighash,
  getCompressedPublicKey,
  pubKeyHash,
  encodeDerSignature,
  makeP2WPKHWitness,
  makeP2PKHScriptSig,
  serializeWitnessTx,
  serializeLegacyTx,
  computeTxid,
  computeLegacyTxid,
  formatBtcFee as formatLtcFee,
  formatSats,
} from "./btcTx";

import {
  type UTXO,
  type BtcUnsignedTx,
  type BtcInput,
  type BtcOutput,
  type BtcAddressType,
  type FeeRates,
  selectUtxos,
  outputScriptsSameNetwork,
} from "./btcTx";

// ── Binary helpers ──────────────────────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ── LTC mempool-compatible API ──────────────────────────────────

const LTC_API_DEFAULT = LTC_ESPLORA_MAINNET;

export function ltcApiUrl(explorerUrl?: string): string {
  if (!explorerUrl) return LTC_API_DEFAULT;
  const base = explorerUrl.replace(/\/+$/, "");
  return `${base}/api`;
}

/** UTXOs: Blockbook first on mainnet, Esplora as fallback. */
export async function fetchUtxos(address: string, apiBase?: string): Promise<UTXO[]> {
  const api = apiBase ?? LTC_API_DEFAULT;
  const bb = ltcBlockbookFor(api);
  if (bb) {
    try { return await blockbookUtxos(bb, address); } catch { /* fall back to Esplora */ }
  }
  const res = await fetch(`${api}/address/${address}/utxo`);
  if (!res.ok) throw new Error(`Failed to fetch LTC UTXOs: ${res.status}`);
  return res.json();
}

export async function fetchFeeRates(apiBase?: string): Promise<FeeRates> {
  const api = apiBase ?? LTC_API_DEFAULT;
  const res = await fetch(`${api}/v1/fees/recommended`);
  if (!res.ok) throw new Error(`Failed to fetch LTC fee rates: ${res.status}`);
  return res.json();
}

// ── Address ↔ scriptPubKey (LTC-specific) ────────────────────────

/** LTC address -> scriptPubKey + network. Throws on anything we cannot safely pay to. */
export function parseLtcAddress(address: string): { scriptPubKey: Uint8Array; testnet: boolean } {
  if (/^t?ltc1/i.test(address)) {
    const seg = decodeSegwitAddress(address, ["ltc", "tltc"]);
    return { scriptPubKey: segwitScriptPubKey(seg), testnet: seg.hrp === "tltc" };
  }
  const decoded = b58check.decode(address);
  if (decoded.length !== 21) throw new Error(`Invalid LTC address: ${address}`);
  const h = decoded.slice(1);
  // Testnet version bytes (0x6f / 0xc4) are shared with BTC testnet, so those cannot be told apart.
  switch (decoded[0]) {
    // P2PKH: mainnet 0x30 ("L"), testnet 0x6f ("m"/"n")
    case 0x30: case 0x6f:
      return { scriptPubKey: concat(new Uint8Array([0x76, 0xa9, 0x14]), h, new Uint8Array([0x88, 0xac])), testnet: decoded[0] === 0x6f };
    // P2SH: mainnet 0x32 ("M"), testnet 0xc4 ("2")
    case 0x32: case 0xc4:
      return { scriptPubKey: concat(new Uint8Array([0xa9, 0x14]), h, new Uint8Array([0x87])), testnet: decoded[0] === 0xc4 };
  }
  throw new Error(`Unsupported LTC address format: ${address}`);
}

export function addressToScriptPubKey(address: string): Uint8Array {
  return parseLtcAddress(address).scriptPubKey;
}

// ── Address type detection ───────────────────────────────────────

export function detectAddressType(address: string): BtcAddressType {
  if (address.startsWith("ltc1q") || address.startsWith("tltc1q")) return "p2wpkh";
  return "p2pkh";
}

// ── Build transaction ───────────────────────────────────────────

export function buildLtcTransaction(
  toAddress: string,
  amountSats: bigint,
  utxos: UTXO[],
  feeRateSatPerVB: number,
  changeAddress: string,
  addrType: BtcAddressType = "p2wpkh",
  rbf: boolean = true,
  useAllUtxos: boolean = false,
): BtcUnsignedTx {
  const { selected, change } = selectUtxos(utxos, amountSats, feeRateSatPerVB, addrType, useAllUtxos, toAddress, changeAddress);

  const inputs: BtcInput[] = selected.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    value: BigInt(u.value),
    sequence: rbf ? 0xfffffffd : 0xffffffff,
  }));

  const scripts = outputScriptsSameNetwork(parseLtcAddress, toAddress, changeAddress);
  const outputs: BtcOutput[] = [{ value: amountSats, scriptPubKey: scripts.to }];

  if (change > 0n) {
    outputs.push({ value: change, scriptPubKey: scripts.change });
  }

  return { version: 2, inputs, outputs, locktime: 0 };
}

// ── Broadcast ───────────────────────────────────────────────────

/** A node saying it already has this tx (mempool or chain). */
const DUPLICATE = /already (known|in (the )?(mempool|block ?chain))|txn-already|-27:/i;

/**
 * Broadcast: Blockbook first on mainnet. Its node verdict (4xx "-NN: ...") is final; on no verdict (timeout,
 * 5xx, bad answer) the same bytes go to Esplora, where "already known" means Blockbook relayed it after all.
 */
export async function broadcastLtcTx(rawHex: string, apiBase?: string): Promise<string> {
  const api = apiBase ?? LTC_API_DEFAULT;
  const bb = ltcBlockbookFor(api);
  let bbError = "";
  if (bb) {
    try { return await blockbookBroadcast(bb, rawHex); } catch (e) {
      if (e instanceof BlockbookNodeVerdict) {
        if (DUPLICATE.test(e.message)) return rawTxid(rawHex); // re-broadcast of a tx the node already has
        throw new Error(`LTC broadcast failed: ${e.message}`);
      }
      bbError = `${e instanceof Error ? e.message : e}; `;
    }
  }
  const res = await fetch(`${api}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawHex,
  });
  if (!res.ok) {
    const text = await res.text();
    if (bbError && DUPLICATE.test(text)) return rawTxid(rawHex);
    throw new Error(`LTC broadcast failed: ${bbError}${text}`);
  }
  return res.text();
}

// ── Wait for confirmation ───────────────────────────────────────

export async function waitForLtcConfirmation(
  txid: string,
  onPoll?: (attempt: number) => void,
  maxAttempts = 60,
  intervalMs = 5000,
  apiBase?: string
): Promise<{ confirmed: boolean; blockHeight?: number }> {
  const api = apiBase ?? LTC_API_DEFAULT;
  const bb = ltcBlockbookFor(api);
  for (let i = 0; i < maxAttempts; i++) {
    onPoll?.(i + 1);
    // Blockbook first on mainnet (null = still in its mempool); Esplora only when Blockbook fails.
    const height = bb ? await blockbookTxHeight(bb, txid).catch(() => undefined) : undefined;
    if (typeof height === "number") return { confirmed: true, blockHeight: height };
    if (height === undefined) {
      try {
        const res = await fetch(`${api}/tx/${txid}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status?.confirmed) {
            return { confirmed: true, blockHeight: data.status.block_height };
          }
        }
      } catch {
        // ignore fetch errors, keep polling
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { confirmed: false };
}

// ── Address validation ──────────────────────────────────────────

export function isValidLtcAddress(address: string): boolean {
  try {
    parseLtcAddress(address);
    return true;
  } catch {
    return false;
  }
}
