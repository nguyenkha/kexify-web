import type { ChainAdapter, Chain, BalanceResult, Transaction } from "../../shared/types";
import { hexToBytes } from "../../shared/utils";
import { beginCell, Cell, contractAddress } from "@ton/core";

// ── Wallet V4R2 code cell (constant for all v4r2 wallets) ───────

const WALLET_V4R2_CODE = Cell.fromBoc(
  Buffer.from(
    "te6cckECFAEAAtQAART/APSkE/S88sgLAQIBIAIPAgFIAwYC5tAB0NMDIXGwkl8E4CLXScEgkl8E4ALTHyGCEHBsdWe9IoIQZHN0cr2wkl8F4AP6QDAg+kQByMoHy//J0O1E0IEBQNch9AQwXIEBCPQKb6Exs5JfB+AF0z/IJYIQcGx1Z7qSODDjDQOCEGRzdHK6kl8G4w0EBQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAHDgIBIAgNAgFYCQoAPbKd+1E0IEBQNch9AQwAsjKB8v/ydABgQEI9ApvoTGACASALDAAZrc52omhAIGuQ64X/wAAZrx32omhAEGuQ64WPwAARuMl+1E0NcLH4AFm9JCtvaiaECAoGuQ+gIYRw1AgIR6STfSmRDOaQPp/5g3gSgBt4EBSJhxWfMYQE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVAj45Sg=",
    "base64",
  ),
)[0];

const WALLET_V4R2_SUBWALLET_ID = 698983191;

// ── Ed25519 key extraction ──────────────────────────────────────

/** Extract 32-byte Ed25519 key from raw or SEC1 uncompressed format */
function extractEd25519Key(pubKeyBytes: Uint8Array): Buffer {
  let key32: Uint8Array;
  if (pubKeyBytes.length === 32) {
    key32 = pubKeyBytes;
  } else if (pubKeyBytes.length === 65 && pubKeyBytes[0] === 0x04) {
    const x_be = pubKeyBytes.slice(1, 33);
    const y_le = pubKeyBytes.slice(33).reverse();
    key32 = new Uint8Array(y_le);
    key32[31] = (key32[31] & 0x7f) | ((x_be[31] & 1) << 7);
  } else {
    throw new Error(`Expected 32 or 65-byte Ed25519 public key, got ${pubKeyBytes.length} bytes`);
  }
  return Buffer.from(key32);
}

// ── Address derivation ──────────────────────────────────────────

/**
 * Derive a TON user-friendly address from a public key hex string.
 * Uses Wallet V4R2 contract (standard TON wallet).
 * Builds the state init (code + data) and computes contractAddress.
 */
export function publicKeyToTonAddress(eddsaPubKeyHex: string): string {
  const pubKey = extractEd25519Key(hexToBytes(eddsaPubKeyHex));

  // Data cell: seqno(32) + subwalletId(32) + publicKey(256)
  const data = beginCell()
    .storeUint(0, 32) // seqno
    .storeUint(WALLET_V4R2_SUBWALLET_ID, 32)
    .storeBuffer(pubKey, 32)
    .endCell();

  const addr = contractAddress(0, { code: WALLET_V4R2_CODE, data });
  return addr.toString({ bounceable: false, urlSafe: true });
}

export function isValidTonAddress(address: string): boolean {
  // Raw format: workchain:hex(64)
  if (/^-?[0-9]+:[0-9a-fA-F]{64}$/.test(address)) return true;
  // User-friendly: base64url, 48 chars with valid checksum
  if (address.length !== 48) return false;
  try {
    const b64 = address.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    if (bytes.length !== 36) return false;
    const tag = bytes[0];
    if (tag !== 0x11 && tag !== 0x51) return false;
    // CRC16-CCITT checksum validation
    let crc = 0;
    for (let i = 0; i < 34; i++) {
      crc ^= bytes[i] << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return bytes[34] === (crc >> 8) && bytes[35] === (crc & 0xff);
  } catch {
    return false;
  }
}

// ── Balance formatting ──────────────────────────────────────────

const PAGE_SIZE = 20;

function formatBalance(raw: bigint, decimals: number): string {
  if (raw === 0n) return "0";
  const str = raw.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  const fmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${fmt}.${fracPart}` : fmt;
}

// ── TON Center API v2 helpers ───────────────────────────────────

function apiBase(chain: Chain): string {
  return chain.rpcUrl || "https://toncenter.com/api/v2";
}

async function tonApi(chain: Chain, method: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${apiBase(chain)}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TON API ${method} failed: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`TON API error: ${data.error || "unknown"}`);
  return data.result;
}

// ── Adapter ─────────────────────────────────────────────────────

export const tonAdapter: ChainAdapter = {
  type: "ton",
  signingAlgorithm: "eddsa",

  deriveAddress(pubKeyHex: string): string {
    return publicKeyToTonAddress(pubKeyHex);
  },

  isValidAddress(address: string): boolean {
    return isValidTonAddress(address);
  },

  async fetchNativeBalance(address, chain, nativeAsset): Promise<BalanceResult | null> {
    try {
      const result = await tonApi(chain, "getAddressBalance", { address }) as string;
      const balance = BigInt(result);
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

  async fetchTokenBalances(address, chain, tokenAssets): Promise<BalanceResult[]> {
    if (tokenAssets.length === 0) return [];
    // Jettons (TEP-74): query jetton wallet balance for each token
    const results = await Promise.all(
      tokenAssets.map(async (asset) => {
        try {
          // Call get_wallet_address on the jetton master contract
          const walletRes = await tonApi(chain, "runGetMethod", {
            address: asset.contractAddress!,
            method: "get_wallet_address",
            stack: JSON.stringify([["tvm.Slice", address]]),
          }) as { stack?: [string, { bytes?: string }][] };
          if (!walletRes?.stack?.[0]) return null;

          const jettonWalletAddr = walletRes.stack[0][1]?.bytes;
          if (!jettonWalletAddr) return null;

          // Call get_wallet_data on the jetton wallet to get balance
          const dataRes = await tonApi(chain, "runGetMethod", {
            address: jettonWalletAddr,
            method: "get_wallet_data",
          }) as { stack?: [string, { value?: string }][] };
          if (!dataRes?.stack?.[0]) return null;

          const balance = BigInt(dataRes.stack[0][1]?.value ?? "0");
          if (balance === 0n) return null;

          return {
            asset,
            chain,
            balance: balance.toString(),
            formatted: formatBalance(balance, asset.decimals),
          };
        } catch {
          return null;
        }
      }),
    );
    return results.filter((r): r is BalanceResult => r !== null);
  },

  async fetchTransactions(address, chain, asset, page) {
    try {
      const result = await tonApi(chain, "getTransactions", {
        address,
        limit: String(PAGE_SIZE + 1),
        offset: String((page - 1) * PAGE_SIZE),
      }) as {
        hash: string;
        utime: number;
        in_msg?: { source: string; destination: string; value: string };
        out_msgs?: { source: string; destination: string; value: string }[];
      }[];

      if (!Array.isArray(result)) return { transactions: [], hasMore: false };
      const hasMore = result.length > PAGE_SIZE;
      const slice = result.slice(0, PAGE_SIZE);

      const txs: Transaction[] = [];
      for (const tx of slice) {
        if (!asset.isNative) continue; // Jetton tx parsing requires BOC — deferred

        // Incoming: in_msg with value > 0 from external source
        if (tx.in_msg?.source && BigInt(tx.in_msg.value || "0") > 0n) {
          txs.push({
            hash: tx.hash,
            from: tx.in_msg.source,
            to: tx.in_msg.destination,
            value: tx.in_msg.value,
            formatted: formatBalance(BigInt(tx.in_msg.value), asset.decimals),
            symbol: asset.symbol,
            timestamp: tx.utime,
            direction: "in",
            confirmed: true,
          });
        }
        // Outgoing: out_msgs with value > 0
        if (tx.out_msgs) {
          for (const msg of tx.out_msgs) {
            if (BigInt(msg.value || "0") > 0n) {
              txs.push({
                hash: tx.hash,
                from: msg.source,
                to: msg.destination,
                value: msg.value,
                formatted: formatBalance(BigInt(msg.value), asset.decimals),
                symbol: asset.symbol,
                timestamp: tx.utime,
                direction: "out",
                confirmed: true,
              });
            }
          }
        }
      }

      return { transactions: txs, hasMore };
    } catch {
      return { transactions: [], hasMore: false };
    }
  },
};
