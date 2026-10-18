import type { ChainAdapter, BalanceResult, Transaction } from "../../shared/types";
import { historyWithProxyFallback, PublicReadError, type PublicHistoryPage } from "./chain-proxy-client";
import { proxyUtxoBalance, proxyUtxoHistory } from "./chain-proxy-utxo";
import { hexToBytes, bytesToHex } from "../../shared/utils";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { dogeAddressFromHash, fetchDogeBalance, fetchDogeHistoryPage, isValidDogeAddress } from "./dogeTx";
import { formatUnits } from "../review/review-format";

const PAGE_SIZE = 10; // SoChain's page

/** Raw secp256k1 key from the DER SubjectPublicKeyInfo the MPC keygen returns (or the key itself). */
function extractPublicKeyFromDER(pubKeyHex: string): string {
  const der = hexToBytes(pubKeyHex);
  for (let i = 0; i < der.length - 2; i++) {
    if (der[i] === 0x03 && der[i + 2] === 0x00) {
      return bytesToHex(der.slice(i + 3, i + 2 + der[i + 1]));
    }
  }
  return pubKeyHex;
}

/** DOGE P2PKH address ("D...") of a DER-encoded or raw secp256k1 public key. Mainnet only. */
export function publicKeyToDogeAddress(pubKeyHex: string): string {
  const compressed = hexToBytes(secp256k1.Point.fromHex(extractPublicKeyFromDER(pubKeyHex)).toHex(true));
  return dogeAddressFromHash(ripemd160(sha256(compressed)));
}

/** "1234567.5" -> "1,234,567.5", as the other adapters show balances. */
const fmt = (sats: bigint) => formatUnits(sats, 8).replace(/^\d+/, (i) => i.replace(/\B(?=(\d{3})+(?!\d))/g, ","));

export const dogeAdapter: ChainAdapter = {
  type: "doge",
  signingAlgorithm: "ecdsa",

  deriveAddress(pubKeyHex: string): string {
    return publicKeyToDogeAddress(pubKeyHex);
  },

  isValidAddress(address: string): boolean {
    return isValidDogeAddress(address);
  },

  async fetchNativeBalance(address, chain, nativeAsset): Promise<BalanceResult | null> {
    let balance: bigint | null = null;
    try { balance = await fetchDogeBalance(address); } catch { /* falls back to the chain proxy */ }
    balance ??= await proxyUtxoBalance(chain, address);
    if (balance === null) return null;
    return { asset: nativeAsset, chain, balance: balance.toString(), formatted: fmt(balance) };
  },

  async fetchTokenBalances(): Promise<BalanceResult[]> {
    return [];
  },

  async fetchTransactions(address, chain, asset, page) {
    return historyWithProxyFallback(
      `${chain.id}:${address}:${asset.id}`,
      page,
      () => publicTransactions(address, asset.symbol, page),
      async () => (await proxyUtxoHistory(chain, address))
        ?.map((r) => ({ ...r, formatted: fmt(BigInt(r.value)), symbol: asset.symbol })) ?? null,
    );
  },
};

/** SoChain history page. Throws PublicReadError on a bad answer; network errors and timeouts throw. */
async function publicTransactions(address: string, symbol: string, page: number): Promise<PublicHistoryPage> {
  let rows;
  try {
    rows = await fetchDogeHistoryPage(address, page);
  } catch (e) {
    if (e instanceof TypeError || (e instanceof DOMException && e.name === "TimeoutError")) throw e;
    throw new PublicReadError(e instanceof Error ? e.message : String(e));
  }
  const txs: Transaction[] = rows.map((r) => {
    const net = r.received - r.sent;
    const direction: "in" | "out" | "self" = net > 0n ? "in" : net < 0n ? "out" : "self";
    const value = net < 0n ? -net : net;
    // SoChain names no counterparty: the other side stays empty, as on the proxy's per-address sources.
    return {
      hash: r.txid,
      from: direction === "in" ? "" : address,
      to: direction === "out" ? "" : address,
      value: value.toString(),
      formatted: fmt(value),
      symbol,
      timestamp: r.time ?? Math.floor(Date.now() / 1000),
      direction,
      confirmed: r.confirmed,
    };
  });
  return { transactions: txs, hasMore: rows.length === PAGE_SIZE, rawRows: rows.length };
}
