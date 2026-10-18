import type { ChainAdapter, Chain, BalanceResult } from "../../shared/types";
import { hexToBytes } from "../../shared/utils";
import { historyWithProxyFallback, PublicReadError, PUBLIC_TIMEOUT_MS, type PublicHistoryPage } from "./chain-proxy-client";
import { proxyTonAccount, proxyTonHistory, tonRaw } from "./chain-proxy-ton";
import { formatTonUnits as formatBalance, tonJettonTransactions, tonNativeTransactions, type JettonTransferRow, type TonTxRow } from "./ton-history-rows";
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

  // Data cell: seqno(32) + subwalletId(32) + publicKey(256) + plugins(dict)
  const data = beginCell()
    .storeUint(0, 32) // seqno
    .storeUint(WALLET_V4R2_SUBWALLET_ID, 32)
    .storeBuffer(pubKey, 32)
    .storeBit(false) // empty plugins dictionary
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

// ── TON Center API v2 helpers ───────────────────────────────────

function apiBase(chain: Chain): string {
  return chain.rpcUrl || "https://toncenter.com/api/v2";
}

// Sequential queue: toncenter free tier allows 1 req/sec
let tonApiQueue: Promise<void> = Promise.resolve();

/** Queue a raw fetch through the rate limiter (for v3 endpoints etc.) */
function tonQueuedFetch(url: string): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    tonApiQueue = tonApiQueue.then(async () => {
      try {
        resolve(await fetch(url, { signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS) }));
      } catch (err) {
        reject(err);
      }
      await new Promise((r) => setTimeout(r, 1100));
    });
  });
}

async function tonApi(chain: Chain, method: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${apiBase(chain)}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await tonQueuedFetch(url.toString());
  if (!res.ok) throw new PublicReadError(`TON API ${method} failed: ${res.status}`);
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new PublicReadError(`TON API error: ${data?.error || "unknown"}`);
  return data.result;
}

// ── Jetton transaction history (v3 API) ─────────────────────────

/** One public page of a jetton's transfers. Throws PublicReadError on a bad answer; network errors throw. */
async function fetchJettonTransactions(
  ownerAddress: string,
  chain: Chain,
  asset: { decimals: number; symbol: string; contractAddress?: string | null },
  page: number,
): Promise<PublicHistoryPage> {
  const baseUrl = (chain.rpcUrl || "https://toncenter.com/api/v2").replace(/\/api\/v2\/?$/, "");
  const url = new URL(`${baseUrl}/api/v3/jetton/transfers`);
  url.searchParams.set("owner_address", ownerAddress);
  url.searchParams.set("jetton_master", asset.contractAddress!);
  url.searchParams.set("direction", "both");
  url.searchParams.set("limit", String(PAGE_SIZE + 1));
  url.searchParams.set("offset", String((page - 1) * PAGE_SIZE));
  url.searchParams.set("sort", "desc");

  const res = await tonQueuedFetch(url.toString());
  if (!res.ok) throw new PublicReadError(`TON jetton transfers: ${res.status}`);
  const data = await res.json().catch(() => null);
  const transfers = data?.jetton_transfers;
  if (!Array.isArray(transfers)) throw new PublicReadError("TON jetton transfers: shape");

  const hasMore = transfers.length > PAGE_SIZE;
  const slice = transfers.slice(0, PAGE_SIZE) as JettonTransferRow[];
  // address_book maps raw addresses to user-friendly format
  const addrBook = (data.address_book ?? {}) as Record<string, { user_friendly?: string }>;
  const friendly = (raw: string) => addrBook[raw]?.user_friendly ?? raw;
  const ownerRaw = tonRaw(ownerAddress);
  const rows = slice.map((t) => ({ ...t, source: friendly(t.source), destination: friendly(t.destination), rawSource: t.source }));
  return {
    transactions: tonJettonTransactions(rows, asset, (t) => tonRaw((t as typeof rows[0]).rawSource) === ownerRaw),
    hasMore,
    rawRows: transfers.length,
  };
}

/** One public page of native transactions (v2 getTransactions). */
async function fetchNativeTransactions(address: string, chain: Chain, asset: { decimals: number; symbol: string }, page: number): Promise<PublicHistoryPage> {
  const result = await tonApi(chain, "getTransactions", {
    address,
    limit: String(PAGE_SIZE + 1),
    offset: String((page - 1) * PAGE_SIZE),
  }) as TonTxRow[];
  if (!Array.isArray(result)) throw new PublicReadError("TON getTransactions: shape");
  return {
    transactions: tonNativeTransactions(result.slice(0, PAGE_SIZE), asset),
    hasMore: result.length > PAGE_SIZE,
    rawRows: result.length,
  };
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
    let balance: bigint | null = null;
    try {
      balance = BigInt(await tonApi(chain, "getAddressBalance", { address }) as string);
    } catch {
      balance = (await proxyTonAccount(chain, address))?.balance ?? null;
    }
    if (balance === null) return null;
    return {
      asset: nativeAsset,
      chain,
      balance: balance.toString(),
      formatted: formatBalance(balance, nativeAsset.decimals),
    };
  },

  async fetchTokenBalances(address, chain, tokenAssets): Promise<BalanceResult[]> {
    if (tokenAssets.length === 0) return [];
    // Jettons (TEP-74): use toncenter v3 API to query jetton wallets by owner
    // Fetch sequentially through the shared rate-limit queue
    const results: (BalanceResult | null)[] = [];
    // After one public failure the proxy's single answer serves the remaining tokens too (no more queued reads).
    let account: Awaited<ReturnType<typeof proxyTonAccount>> | undefined;
    for (const asset of tokenAssets) {
      try {
        if (account !== undefined) throw new PublicReadError("TON: public jetton reads failed");
        const baseUrl = (chain.rpcUrl || "https://toncenter.com/api/v2").replace(/\/api\/v2\/?$/, "");
        const url = new URL(`${baseUrl}/api/v3/jetton/wallets`);
        url.searchParams.set("owner_address", address);
        url.searchParams.set("jetton_address", asset.contractAddress!);
        url.searchParams.set("limit", "1");

        const res = await tonQueuedFetch(url.toString());
        if (!res.ok) throw new PublicReadError(`TON jetton wallets: ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data?.jetton_wallets)) throw new PublicReadError("TON jetton wallets: shape");

        const wallet = data.jetton_wallets[0];
        const balance = BigInt(wallet?.balance ?? "0");
        results.push(balance === 0n ? null : {
          asset,
          chain,
          balance: balance.toString(),
          formatted: formatBalance(balance, asset.decimals),
        });
      } catch {
        // Public read failed: the proxy lists every jetton wallet of the owner in one call (shared memo).
        if (account === undefined) account = await proxyTonAccount(chain, address);
        const master = asset.contractAddress ? tonRaw(asset.contractAddress) : null;
        const held = account && master ? account.jettons.get(master) : undefined;
        const balance = held?.balance ?? (account && master && !account.jettonsTruncated ? 0n : null);
        results.push(!balance ? null : { asset, chain, balance: balance.toString(), formatted: formatBalance(balance, asset.decimals) });
      }
    }
    return results.filter((r): r is BalanceResult => r !== null);
  },

  async fetchTransactions(address, chain, asset, page) {
    // For Jetton tokens, use v3 API to fetch transfer events
    const jetton = !asset.isNative && !!asset.contractAddress;
    return historyWithProxyFallback(
      `${chain.id}:${address}:${asset.id}`,
      page,
      () => (jetton ? fetchJettonTransactions(address, chain, asset, page) : fetchNativeTransactions(address, chain, asset, page)),
      () => proxyTonHistory(chain, address, asset),
    );
  },
};
