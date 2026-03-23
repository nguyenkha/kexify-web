import type { ChainAdapter, Chain, Asset, BalanceResult, Transaction } from "../../shared/types";
import { bech32 } from "@scure/base";

// ── Cardano address encoding (Ed25519 + Blake2b-224 + Bech32) ──

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Extract 32-byte Ed25519 public key from hex (handles 32-byte raw and 65-byte SEC1 uncompressed) */
function extractEd25519Key(pubKeyBytes: Uint8Array): Uint8Array {
  if (pubKeyBytes.length === 32) return pubKeyBytes;
  if (pubKeyBytes.length === 65 && pubKeyBytes[0] === 0x04) {
    const xBe = pubKeyBytes.slice(1, 33);
    const yLe = pubKeyBytes.slice(33).reverse();
    const key32 = new Uint8Array(yLe);
    key32[31] = (key32[31] & 0x7f) | ((xBe[31] & 1) << 7);
    return key32;
  }
  throw new Error(`Expected 32 or 65-byte Ed25519 public key, got ${pubKeyBytes.length} bytes`);
}

// Async blake2b loader (same pattern as ALGO adapter's SHA-512/256 loader)
let _blake2bSync: ((data: Uint8Array, opts: { dkLen: number }) => Uint8Array) | null = null;
async function ensureBlake2b(): Promise<void> {
  if (!_blake2bSync) {
    const mod = await import("@noble/hashes/blake2b");
    _blake2bSync = mod.blake2b;
  }
}

function publicKeyToAdaAddress(pubKey32: Uint8Array, testnet = false): string {
  if (!_blake2bSync) throw new Error("ADA adapter not initialized — call initAdaAdapter() first");
  const keyHash = _blake2bSync(pubKey32, { dkLen: 28 }); // Blake2b-224
  // Enterprise address: type 6 (0110) | network (0=testnet, 1=mainnet)
  const header = testnet ? 0x60 : 0x61;
  const payload = new Uint8Array(29);
  payload[0] = header;
  payload.set(keyHash, 1);
  const prefix = testnet ? "addr_test" : "addr";
  return bech32.encode(prefix, bech32.toWords(payload));
}

function isValidAdaAddress(address: string): boolean {
  try {
    if (!address.startsWith("addr1") && !address.startsWith("addr_test1")) return false;
    const prefix = address.startsWith("addr_test") ? "addr_test" : "addr";
    // Cardano base addresses can be ~103 chars, exceeding bech32 default 90-char limit
    const decoded = bech32.decode(address as `${string}1${string}`, 120);
    return decoded.prefix === prefix;
  } catch {
    return false;
  }
}

// ── Tatum Rosetta API (rate-limited queue: 5 req/min) ──

const ROSETTA_MAINNET = "https://cardano-mainnet.gateway.tatum.io";
const ROSETTA_PREPROD = "https://cardano-preprod.gateway.tatum.io";

// Sequential queue: Tatum free tier allows 5 req/min (~12s between requests)
let adaApiQueue: Promise<void> = Promise.resolve();

function adaQueuedFetch(url: string, body: object): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    adaApiQueue = adaApiQueue.then(async () => {
      try {
        resolve(await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }));
      } catch (err) {
        reject(err);
      }
      await new Promise((r) => setTimeout(r, 13_000)); // 13s between requests (5/min)
    });
  });
}

function rosettaUrl(chain: Chain): string {
  // Use rpcUrl if set, otherwise determine from chain name
  if (chain.rpcUrl) return chain.rpcUrl;
  return chain.name.includes("PREPROD") ? ROSETTA_PREPROD : ROSETTA_MAINNET;
}

function networkId(chain: Chain): { blockchain: string; network: string } {
  return {
    blockchain: "cardano",
    network: chain.name.includes("PREPROD") ? "preprod" : "mainnet",
  };
}

function formatAdaAmount(lovelace: string | number, decimals: number): string {
  const raw = typeof lovelace === "string" ? BigInt(lovelace) : BigInt(lovelace);
  if (raw === 0n) return "0";
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (frac === 0n) return whole.toLocaleString("en-US");
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

// ── Block timestamp cache (avoids re-fetching the same block) ──
const blockTimeCache = new Map<string, number>(); // "network:blockIndex" → unix seconds

/** Fetch block timestamp from Rosetta /block endpoint (queued to respect rate limit) */
async function fetchBlockTime(chain: Chain, blockIndex: number, blockHash: string): Promise<number> {
  const key = `${networkId(chain).network}:${blockIndex}`;
  const cached = blockTimeCache.get(key);
  if (cached) return cached;

  try {
    const res = await adaQueuedFetch(`${rosettaUrl(chain)}/block`, {
      network_identifier: networkId(chain),
      block_identifier: { index: blockIndex, hash: blockHash },
    });
    if (res.ok) {
      const data = await res.json();
      // Rosetta block timestamp is in milliseconds
      const tsMs = data.block?.timestamp ?? 0;
      if (tsMs > 0) {
        const tsSec = Math.floor(tsMs / 1000);
        blockTimeCache.set(key, tsSec);
        return tsSec;
      }
    }
  } catch { /* fall through */ }
  return Math.floor(Date.now() / 1000);
}

// ── Adapter ──

export const adaAdapter: ChainAdapter = {
  type: "ada",
  signingAlgorithm: "eddsa",

  deriveAddress(pubKeyHex: string, opts?: { testnet?: boolean }): string {
    const pubKey = extractEd25519Key(hexToBytes(pubKeyHex));
    return publicKeyToAdaAddress(pubKey, opts?.testnet);
  },

  isValidAddress(address: string): boolean {
    return isValidAdaAddress(address);
  },

  async fetchNativeBalance(address: string, chain: Chain, nativeAsset: Asset): Promise<BalanceResult | null> {
    try {
      const res = await adaQueuedFetch(`${rosettaUrl(chain)}/account/balance`, {
        network_identifier: networkId(chain),
        account_identifier: { address },
      });
      if (!res.ok) {
        if (res.status === 429) return null; // rate limited, will retry on next poll
        return null;
      }
      const data = await res.json();
      const adaBalance = data.balances?.find((b: { currency: { symbol: string } }) => b.currency.symbol === "ADA");
      const balance = adaBalance?.value ?? "0";
      return {
        asset: nativeAsset,
        chain,
        balance,
        formatted: formatAdaAmount(balance, nativeAsset.decimals),
      };
    } catch {
      return null;
    }
  },

  async fetchTokenBalances(): Promise<BalanceResult[]> {
    // Cardano native tokens deferred — just ADA for now
    return [];
  },

  async fetchTransactions(
    address: string,
    chain: Chain,
    asset: Asset,
    page: number,
  ): Promise<{ transactions: Transaction[]; hasMore: boolean }> {
    try {
      const limit = 10; // Keep small due to rate limits
      const offset = (page - 1) * limit;

      const res = await adaQueuedFetch(`${rosettaUrl(chain)}/search/transactions`, {
        network_identifier: networkId(chain),
        account_identifier: { address },
        limit,
        offset,
      });
      if (!res.ok) return { transactions: [], hasMore: false };
      const data = await res.json();
      const totalCount = data.total_count ?? 0;
      const hasMore = offset + limit < totalCount;

      const entries: {
        transaction: {
          transaction_identifier: { hash: string };
          operations: {
            type: string;
            status: string;
            account: { address: string };
            amount: { value: string; currency: { symbol: string } };
          }[];
        };
        block_identifier: { index: number; hash: string };
      }[] = data.transactions ?? [];

      // Fetch block timestamps (deduped — multiple txs may share a block)
      const uniqueBlocks = new Map<number, string>();
      for (const e of entries) {
        const bi = e.block_identifier;
        if (bi?.index && !uniqueBlocks.has(bi.index)) uniqueBlocks.set(bi.index, bi.hash);
      }
      const blockTimes = new Map<number, number>();
      for (const [idx, hash] of uniqueBlocks) {
        blockTimes.set(idx, await fetchBlockTime(chain, idx, hash));
      }

      const txs: Transaction[] = entries.map((entry) => {
        const tx = entry.transaction;
        const ops = tx.operations ?? [];

        // Rosetta ops: negative value = input (spent), positive = output (received)
        const adaOps = ops.filter((op) => op.amount?.currency?.symbol === "ADA");
        const myOps = adaOps.filter((op) => op.account?.address === address);
        const otherOps = adaOps.filter((op) => op.account?.address !== address);

        // Net value for our address
        const netValue = myOps.reduce((sum, op) => sum + BigInt(op.amount?.value ?? "0"), 0n);
        const direction: "in" | "out" | "self" =
          netValue > 0n ? "in" : netValue < 0n ? "out" : "self";
        const absValue = netValue < 0n ? -netValue : netValue;

        // Find counterparty (UTXO-aware: if all inputs share one address, use it as sender)
        let counterparty = "";
        const inputOps = adaOps.filter((op) => BigInt(op.amount?.value ?? "0") < 0n);
        const outputOps = adaOps.filter((op) => BigInt(op.amount?.value ?? "0") > 0n);
        if (direction === "in") {
          const inputAddrs = new Set(inputOps.map((op) => op.account?.address));
          if (inputAddrs.size === 1) {
            counterparty = [...inputAddrs][0] ?? "";
          } else {
            const sender = otherOps.find((op) => BigInt(op.amount?.value ?? "0") < 0n);
            counterparty = sender?.account?.address ?? "";
          }
        } else {
          const recipient = outputOps.find((op) => op.account?.address !== address);
          counterparty = recipient?.account?.address ?? "";
        }

        const timestamp = blockTimes.get(entry.block_identifier?.index) ?? Math.floor(Date.now() / 1000);

        return {
          hash: tx.transaction_identifier.hash,
          from: direction === "in" ? counterparty : address,
          to: direction === "out" ? counterparty : address,
          value: absValue.toString(),
          formatted: formatAdaAmount(absValue.toString(), asset.decimals),
          symbol: asset.symbol,
          timestamp,
          direction,
          confirmed: true,
        };
      });

      return { transactions: txs, hasMore };
    } catch {
      return { transactions: [], hasMore: false };
    }
  },
};

/** Initialize the ADA adapter (loads Blake2b). Call once at app startup. */
export async function initAdaAdapter(): Promise<void> {
  await ensureBlake2b();
}
