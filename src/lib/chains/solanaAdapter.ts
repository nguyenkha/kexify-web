import type { Asset, Chain, ChainAdapter, BalanceResult, Transaction } from "../../shared/types";
import { hexToBytes } from "../../shared/utils";
import { base58 } from "@scure/base";
import { KNOWN_PROGRAMS } from "./solanaTx";
import { historyWithProxyFallback, PublicReadError, PUBLIC_TIMEOUT_MS, type PublicHistoryPage } from "./chain-proxy-client";
import { proxySolanaBalances, proxySolanaHistory } from "./chain-proxy-solana";

const BASIC_PROGRAMS = new Set([
  "11111111111111111111111111111111",           // System Program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token Program
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "ComputeBudget111111111111111111111111111111",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // ATA Program
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // Memo
  "Memo1UhkJBfCR6MNB6So8FPo3JoRkx7YDXk5WKLXNRh", // Memo (legacy)
]);

/**
 * Derive a Solana address from a raw Ed25519 public key hex string.
 * Solana addresses are simply base58-encoded 32-byte Ed25519 public keys.
 */
export function publicKeyToSolanaAddress(eddsaPubKeyHex: string): string {
  const pubKeyBytes = hexToBytes(eddsaPubKeyHex);
  let key32: Uint8Array;
  if (pubKeyBytes.length === 32) {
    key32 = pubKeyBytes;
  } else if (pubKeyBytes.length === 65 && pubKeyBytes[0] === 0x04) {
    // SEC1 uncompressed (04 || x_BE(32) || y_BE(32)) → Ed25519 compressed point.
    // SEC1 coordinates are big-endian; Ed25519 encoding is little-endian y
    // with the sign of x in the high bit of the last byte.
    const x_be = pubKeyBytes.slice(1, 33);
    const y_le = pubKeyBytes.slice(33).reverse();
    key32 = new Uint8Array(y_le);
    key32[31] = (key32[31] & 0x7f) | ((x_be[31] & 1) << 7);
  } else {
    throw new Error(`Expected 32 or 65-byte Ed25519 public key, got ${pubKeyBytes.length} bytes`);
  }
  return base58.encode(key32);
}

/**
 * Validate a Solana address (base58-encoded, 32 bytes when decoded).
 */
export function isValidSolanaAddress(address: string): boolean {
  try {
    const decoded = base58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

const PAGE_SIZE = 10;

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

/** publicnode's Solana mainnet RPC keeps no history: getSignaturesForAddress answers [] and getTransaction null for
 * older txs (not an error, so nothing falls back). History reads go to the public mainnet-beta RPC instead. */
const HISTORY_RPC: Record<string, string> = {
  "https://solana-rpc.publicnode.com": "https://api.mainnet-beta.solana.com",
};

export function solanaHistoryRpcUrl(rpcUrl: string): string {
  return HISTORY_RPC[rpcUrl.replace(/\/+$/, "")] ?? rpcUrl;
}

/** Throws on HTTP, RPC or timeout errors (they used to read as a zero balance), so the caller can fall back. */
async function solanaRpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error || data?.result === undefined) throw new Error(`${method}: RPC error`);
  return data.result;
}

export const solanaAdapter: ChainAdapter = {
  type: "solana",
  signingAlgorithm: "eddsa",

  deriveAddress(pubKeyHex: string): string {
    return publicKeyToSolanaAddress(pubKeyHex);
  },

  isValidAddress(address: string): boolean {
    return isValidSolanaAddress(address);
  },

  async fetchNativeBalance(address, chain, nativeAsset): Promise<BalanceResult | null> {
    const result = (balance: bigint): BalanceResult => ({
      asset: nativeAsset,
      chain,
      balance: balance.toString(),
      formatted: formatBalance(balance, nativeAsset.decimals),
    });
    try {
      const res = await solanaRpc(chain.rpcUrl, "getBalance", [address]) as { value?: unknown } | null;
      if (typeof res?.value !== "number") throw new Error("getBalance: invalid");
      return result(BigInt(res.value));
    } catch {
      const proxied = await proxySolanaBalances(chain, address);
      return proxied ? result(proxied.native) : null;
    }
  },

  async fetchTokenBalances(address, chain, tokenAssets): Promise<BalanceResult[]> {
    if (!chain.rpcUrl) return [];
    const promises = tokenAssets.map(async (asset): Promise<{ asset: Asset; balance: bigint | null }> => {
      try {
        const result = await solanaRpc(chain.rpcUrl, "getTokenAccountsByOwner", [
          address,
          { mint: asset.contractAddress },
          { encoding: "jsonParsed" },
        ]) as { value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] } | null;

        if (!Array.isArray(result?.value)) throw new Error("getTokenAccountsByOwner: invalid");
        const accounts = result.value;
        if (accounts.length === 0) return { asset, balance: 0n };
        return { asset, balance: BigInt(accounts[0].account.data.parsed.info.tokenAmount.amount) };
      } catch {
        return { asset, balance: null }; // failed read: filled from the chain proxy below when it can
      }
    });
    const settled = await Promise.all(promises);
    if (settled.some((r) => r.balance === null)) {
      const proxied = await proxySolanaBalances(chain, address);
      if (proxied) {
        for (const r of settled) {
          if (r.balance === null) r.balance = proxied.tokens.get(r.asset.contractAddress!) ?? 0n;
        }
      }
    }
    return settled
      .filter((r): r is { asset: Asset; balance: bigint } => r.balance !== null && r.balance > 0n)
      .map(({ asset, balance }) => ({ asset, chain, balance: balance.toString(), formatted: formatBalance(balance, asset.decimals) }));
  },

  async fetchTransactions(address, chain, asset, page) {
    return historyWithProxyFallback(
      `${address}:${chain.id}:${asset.id}`,
      page,
      () => publicTransactions(address, chain, asset, page),
      async () => (await proxySolanaHistory(chain, address, asset))
        ?.map((r) => ({ ...r, formatted: formatTxValue(r.value, asset.decimals), symbol: asset.symbol })) ?? null,
    );
  },
};

/** Public history page (mainnet-beta for publicnode). Throws on network, HTTP, RPC and timeout errors. */
async function publicTransactions(
  address: string,
  chain: Chain,
  asset: Asset,
  page: number,
): Promise<PublicHistoryPage> {
  const historyRpc = solanaHistoryRpcUrl(chain.rpcUrl);
  const sigRes = await fetch(historyRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [address, { limit: PAGE_SIZE * page + 1 }],
    }),
    signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS),
  });
  if (!sigRes.ok) throw new PublicReadError(`getSignaturesForAddress: HTTP ${sigRes.status}`);
  const sigData = await sigRes.json();
  if (sigData?.error || !Array.isArray(sigData?.result)) throw new PublicReadError("getSignaturesForAddress: RPC error");
  const allSigs: { signature: string; blockTime: number | null; confirmationStatus: string; err: unknown }[] =
    sigData.result || [];

  const start = (page - 1) * PAGE_SIZE;
  const slice = allSigs.slice(start, start + PAGE_SIZE);
  if (slice.length === 0) return { transactions: [], hasMore: false, rawRows: 0 };

  let failedReads = 0; // getTransaction answers that were errors (rate limit, timeout), not "no such tx"
  const txPromises = slice.map(async (sig) => {
    let tx;
    try {
      const txRes = await fetch(historyRpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
        }),
        signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS),
      });
      const txData = txRes.ok ? await txRes.json() : null;
      if (!txData || txData.error) throw new Error("getTransaction failed");
      tx = txData.result;
    } catch {
      failedReads++;
      return null;
    }
    if (!tx) return null;
    try {
      const accountKeys: string[] =
        tx.transaction?.message?.accountKeys?.map((k: { pubkey?: string } | string) =>
          typeof k === "string" ? k : k.pubkey || ""
        ) || [];
      const addrIndex = accountKeys.findIndex((k: string) => k === address);

      let value = "0";
      let direction: "in" | "out" | "self" = "self";
      let from = address;
      let to = address;

      if (!asset.isNative && asset.contractAddress && tx.meta) {
        type TokenBal = { accountIndex: number; mint: string; uiTokenAmount: { amount: string }; owner?: string };
        const preTok: TokenBal[] = tx.meta.preTokenBalances || [];
        const postTok: TokenBal[] = tx.meta.postTokenBalances || [];

        const preEntry = preTok.find((t: TokenBal) => t.mint === asset.contractAddress && t.owner === address);
        const postEntry = postTok.find((t: TokenBal) => t.mint === asset.contractAddress && t.owner === address);

        const preBal = BigInt(preEntry?.uiTokenAmount?.amount ?? "0");
        const postBal = BigInt(postEntry?.uiTokenAmount?.amount ?? "0");
        const diff = postBal - preBal;

        if (diff > 0n) {
          direction = "in";
          value = diff.toString();
          // Find sender: token balance decreased for another owner
          const sender = preTok.find((t: TokenBal) => t.mint === asset.contractAddress && t.owner !== address &&
            BigInt(t.uiTokenAmount?.amount ?? "0") > BigInt(postTok.find((p: TokenBal) => p.mint === asset.contractAddress && p.owner === t.owner)?.uiTokenAmount?.amount ?? "0"));
          from = sender?.owner || "...";
        } else if (diff < 0n) {
          direction = "out";
          value = (-diff).toString();
          // Find receiver: token balance increased for another owner
          const receiver = postTok.find((t: TokenBal) => t.mint === asset.contractAddress && t.owner !== address &&
            BigInt(t.uiTokenAmount?.amount ?? "0") > BigInt(preTok.find((p: TokenBal) => p.mint === asset.contractAddress && p.owner === t.owner)?.uiTokenAmount?.amount ?? "0"));
          to = receiver?.owner || "...";
        } else {
          return null;
        }
      } else if (addrIndex >= 0 && tx.meta) {
        // Extract program IDs from instructions
        type ParsedIx = { programId?: string; program?: string };
        const ixs: ParsedIx[] = tx.transaction?.message?.instructions || [];
        const programIds = new Set(ixs.map((ix: ParsedIx) => ix.programId || "").filter(Boolean));

        // Also include inner instruction programs
        const innerIxs: { instructions: ParsedIx[] }[] = tx.meta.innerInstructions || [];
        for (const inner of innerIxs) {
          for (const ix of inner.instructions || []) {
            if (ix.programId) programIds.add(ix.programId);
          }
        }

        const hasTokenBalanceChange = (tx.meta.preTokenBalances?.length || 0) > 0 ||
          (tx.meta.postTokenBalances?.length || 0) > 0;
        const hasNonBasicProgram = [...programIds].some((p) => !BASIC_PROGRAMS.has(p));

        // Pure SPL token transfer (only basic programs + token changes) — skip,
        // it already shows in the token's detail page
        if (!hasNonBasicProgram && hasTokenBalanceChange) {
          return null;
        }

        const preBalances: bigint[] = (tx.meta.preBalances || []).map((b: number) => BigInt(b));
        const postBalances: bigint[] = (tx.meta.postBalances || []).map((b: number) => BigInt(b));
        const diff = (postBalances[addrIndex] ?? 0n) - (preBalances[addrIndex] ?? 0n);
        if (diff > 0n) {
          direction = "in";
          value = diff.toString();
          // Find sender: account whose balance decreased the most
          let senderIdx = -1, maxDrop = 0n;
          for (let i = 0; i < preBalances.length; i++) {
            if (i === addrIndex) continue;
            const drop = preBalances[i] - postBalances[i];
            if (drop > maxDrop) { maxDrop = drop; senderIdx = i; }
          }
          from = senderIdx >= 0 ? accountKeys[senderIdx] : "...";
        } else if (diff < 0n) {
          direction = "out";
          const fee = BigInt(tx.meta.fee ?? 0);
          const sent = -diff - fee;
          value = (sent > 0n ? sent : -diff).toString();
          // Find receiver: account whose balance increased the most
          let receiverIdx = -1, maxGain = 0n;
          for (let i = 0; i < postBalances.length; i++) {
            if (i === addrIndex) continue;
            const gain = postBalances[i] - preBalances[i];
            if (gain > maxGain) { maxGain = gain; receiverIdx = i; }
          }
          to = receiverIdx >= 0 ? accountKeys[receiverIdx] : "...";
        }

        // Mark non-basic program interactions as contract calls
        if (hasNonBasicProgram) {
          const mainProgram = [...programIds].find((p) => !BASIC_PROGRAMS.has(p));
          return {
            hash: sig.signature,
            from,
            to: mainProgram && KNOWN_PROGRAMS[mainProgram] ? KNOWN_PROGRAMS[mainProgram] : (to === address ? "..." : to),
            value,
            formatted: formatTxValue(value, asset.decimals),
            symbol: asset.symbol,
            timestamp: sig.blockTime || Math.floor(Date.now() / 1000),
            direction,
            confirmed: sig.confirmationStatus === "finalized" || sig.confirmationStatus === "confirmed",
            failed: !!sig.err,
            isContractCall: true,
          } as Transaction;
        }
      }

      return {
        hash: sig.signature,
        from,
        to,
        value,
        formatted: formatTxValue(value, asset.decimals),
        symbol: asset.symbol,
        timestamp: sig.blockTime || Math.floor(Date.now() / 1000),
        direction,
        confirmed: sig.confirmationStatus === "finalized" || sig.confirmationStatus === "confirmed",
        failed: !!sig.err,
      } as Transaction;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(txPromises);
  const txs = results.filter((t): t is Transaction => t !== null);
  return { transactions: txs, hasMore: start + PAGE_SIZE < allSigs.length, rawRows: slice.length, incomplete: failedReads > 0 };
}
