import type { ChainAdapter, BalanceResult, Transaction } from "../../shared/types";
import { hexToBytes, bytesToHex } from "../../shared/utils";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { base58check, bech32 } from "@scure/base";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { isValidLtcAddress } from "./ltcTx";

const PAGE_SIZE = 10;
const b58check = base58check(sha256);

// ── Private helpers ──────────────────────────────────────────────────

function extractPublicKeyFromDER(pubKeyHex: string): string {
  const der = hexToBytes(pubKeyHex);
  for (let i = 0; i < der.length - 2; i++) {
    if (der[i] === 0x03 && der[i + 2] === 0x00) {
      const len = der[i + 1];
      const raw = der.slice(i + 3, i + 2 + len);
      return bytesToHex(raw);
    }
  }
  return pubKeyHex;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function getCompressedKey(rawHex: string): Uint8Array {
  const point = secp256k1.Point.fromHex(rawHex);
  return hexToBytes(point.toHex(true));
}

// ── Exported address derivation ──────────────────────────────────────

/**
 * LTC Legacy (P2PKH) address from a DER-encoded secp256k1 public key.
 * Mainnet: starts with "L" (version 0x30), Testnet: starts with "m" or "n" (version 0x6f)
 */
export function publicKeyToLtcLegacyAddress(
  pubKeyHex: string,
  testnet = false
): string {
  const compressed = getCompressedKey(extractPublicKeyFromDER(pubKeyHex));
  const h = hash160(compressed);
  const version = testnet ? 0x6f : 0x30;
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(h, 1);
  return b58check.encode(payload);
}

/**
 * LTC Native SegWit (P2WPKH) address from a DER-encoded secp256k1 public key.
 * Mainnet: starts with "ltc1q", Testnet: starts with "tltc1q"
 */
export function publicKeyToLtcSegwitAddress(
  pubKeyHex: string,
  testnet = false
): string {
  const compressed = getCompressedKey(extractPublicKeyFromDER(pubKeyHex));
  const h = hash160(compressed);
  const hrp = testnet ? "tltc" : "ltc";
  const words = bech32.toWords(h);
  return bech32.encode(hrp, [0, ...words]);
}

// ── Adapter helpers ──────────────────────────────────────────────────

function formatBalance(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const str = raw.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  const fmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${fmt}.${fracPart}` : fmt;
}

function formatTxValue(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const str = raw.padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  const fmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${fmt}.${fracPart}` : fmt;
}

// ── Chain adapter ────────────────────────────────────────────────────

export const ltcAdapter: ChainAdapter = {
  type: "ltc",
  signingAlgorithm: "ecdsa",

  deriveAddress(pubKeyHex: string, opts?: { testnet?: boolean }): string {
    return publicKeyToLtcSegwitAddress(pubKeyHex, opts?.testnet);
  },

  isValidAddress(address: string): boolean {
    return isValidLtcAddress(address);
  },

  async fetchNativeBalance(address, chain, nativeAsset): Promise<BalanceResult | null> {
    try {
      const apiBase = chain.explorerUrl.replace(/\/+$/, "") + "/api";
      const res = await fetch(`${apiBase}/address/${address}`);
      if (!res.ok) return null;
      const data = await res.json();
      const funded = BigInt(data.chain_stats?.funded_txo_sum ?? 0);
      const spent = BigInt(data.chain_stats?.spent_txo_sum ?? 0);
      const balance = funded - spent;
      return {
        asset: nativeAsset,
        chain,
        balance: balance.toString(),
        formatted: formatBalance(balance, nativeAsset.decimals),
      };
    } catch {
      return null;
    }
  },

  async fetchTokenBalances(): Promise<BalanceResult[]> {
    return [];
  },

  async fetchTransactions(address, chain, asset, page) {
    const apiBase = chain.explorerUrl.replace(/\/+$/, "") + "/api";
    const res = await fetch(`${apiBase}/address/${address}/txs`);
    if (!res.ok) return { transactions: [], hasMore: false };
    const allTxs: Record<string, unknown>[] = await res.json();

    const start = (page - 1) * PAGE_SIZE;
    const slice = allTxs.slice(start, start + PAGE_SIZE);
    const addrLower = address.toLowerCase();

    const txs: Transaction[] = slice.map((tx) => {
      const txid = tx.txid as string;
      const status = tx.status as Record<string, unknown>;
      const confirmed = status?.confirmed === true;
      const timestamp = (status?.block_time as number) || Math.floor(Date.now() / 1000);

      const vout = (tx.vout as { scriptpubkey_address?: string; value: number }[]) || [];
      const vin = (tx.vin as { prevout?: { scriptpubkey_address?: string; value: number } }[]) || [];

      let received = 0;
      let sent = 0;
      for (const o of vout) {
        if (o.scriptpubkey_address?.toLowerCase() === addrLower) received += o.value;
      }
      for (const i of vin) {
        if (i.prevout?.scriptpubkey_address?.toLowerCase() === addrLower) sent += i.prevout.value;
      }

      const net = received - sent;
      const direction: "in" | "out" | "self" =
        net > 0 ? "in" : net < 0 ? "out" : "self";

      let from = address;
      let to = address;
      if (direction === "in") {
        const inputAddrs = new Set(vin.map((i) => i.prevout?.scriptpubkey_address).filter(Boolean));
        from = inputAddrs.size === 1 ? [...inputAddrs][0]! : "";
      } else if (direction === "out") {
        const outputAddr = vout.find((o) => o.scriptpubkey_address?.toLowerCase() !== addrLower);
        to = outputAddr?.scriptpubkey_address ?? "";
      }

      return {
        hash: txid,
        from,
        to,
        value: Math.abs(net).toString(),
        formatted: formatTxValue(Math.abs(net).toString(), asset.decimals),
        symbol: asset.symbol,
        timestamp,
        direction,
        confirmed,
      };
    });

    return { transactions: txs, hasMore: start + PAGE_SIZE < allTxs.length };
  },
};
