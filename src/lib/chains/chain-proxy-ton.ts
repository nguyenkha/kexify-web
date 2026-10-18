// TON answers of the server chain proxy (api/src/chain-proxy/ton-reader.ts) mapped to what the TON adapter and send
// flow use. Only the fallback after the client's own toncenter read failed. The server answers in raw form
// ("0:hex"), so every address is sent and compared raw.

import { Address, Cell, loadMessage } from "@ton/core";
import type { Chain, Transaction } from "../../shared/types";
import { proxyBalance, proxyNetwork, proxyPost, proxyRead, type ProxyBody } from "./chain-proxy-client";
import { TonNodeRejected, tonMessageHash } from "./tonTx";
import { tonJettonTransactions, tonNativeTransactions, type JettonTransferRow, type TonTxRow } from "./ton-history-rows";

/** Raw "wc:hex" form of a TON address (raw or user-friendly), or null. */
export function tonRaw(address: string): string | null {
  try {
    return Address.parse(address).toRawString();
  } catch {
    return null;
  }
}

const UNITS = /^\d{1,40}$/;

export interface TonProxyAccount {
  balance: bigint;
  seqno: number | null;
  state: string;
  /** By raw master address. A master missing here holds 0, unless `jettonsTruncated`. */
  jettons: Map<string, { wallet: string; balance: bigint }>;
  jettonsTruncated: boolean;
}

/** `POST /chain/ton/balance` -> account. null when any field is malformed (never half an answer). */
export function parseTonAccount(body: ProxyBody): TonProxyAccount | null {
  if (typeof body.balance !== "string" || !UNITS.test(body.balance) || !Array.isArray(body.jettons)) return null;
  const seqno = body.seqno === null ? null : Number.isSafeInteger(body.seqno) && (body.seqno as number) >= 0 ? body.seqno as number : undefined;
  if (seqno === undefined) return null;
  const jettons = new Map<string, { wallet: string; balance: bigint }>();
  for (const j of body.jettons as Record<string, unknown>[]) {
    const master = typeof j?.master === "string" ? tonRaw(j.master) : null;
    const wallet = typeof j?.wallet === "string" ? tonRaw(j.wallet) : null;
    if (!master || !wallet || typeof j.balance !== "string" || !UNITS.test(j.balance)) return null;
    jettons.set(master, { wallet, balance: BigInt(j.balance) });
  }
  return { balance: BigInt(body.balance), seqno, state: typeof body.state === "string" ? body.state : "unknown", jettons, jettonsTruncated: body.jettonsTruncated === true };
}

/** Balance, seqno and jetton wallets of `address` through the proxy (one call shared by native + jettons). */
export async function proxyTonAccount(chain: Pick<Chain, "name">, address: string): Promise<TonProxyAccount | null> {
  const network = proxyNetwork(chain);
  const raw = tonRaw(address);
  const body = network && raw ? await proxyBalance(network, raw) : null;
  return body ? parseTonAccount(body) : null;
}

/**
 * Seqno for a send: toncenter first, the proxy's only when the public read threw. Read fresh (not the display memo):
 * a seqno from before the last send would only get the next message rejected. An undeployed wallet has none = 0.
 */
export async function tonSeqnoWithProxyFallback(chain: Pick<Chain, "name">, address: string, publicRead: () => Promise<number>): Promise<number> {
  try {
    return await publicRead();
  } catch (err) {
    const network = proxyNetwork(chain);
    const raw = tonRaw(address);
    const body = network && raw ? await proxyRead(network, "balance", raw) : null;
    const account = body ? parseTonAccount(body) : null;
    if (typeof account?.seqno === "number") return account.seqno;
    if (account && account.seqno === null && /^(uninit|uninitialized|nonexist)$/.test(account.state)) return 0;
    throw err;
  }
}

/** The owner's jetton wallet for a send: toncenter first, the proxy's list only when the public read threw. */
export async function jettonWalletWithProxyFallback(chain: Pick<Chain, "name">, owner: string, master: string,
  publicRead: () => Promise<string>): Promise<string> {
  try {
    return await publicRead();
  } catch (err) {
    const masterRaw = tonRaw(master);
    const wallet = masterRaw ? (await proxyTonAccount(chain, owner))?.jettons.get(masterRaw)?.wallet : undefined;
    if (wallet) return wallet;
    throw err;
  }
}

/** Page-1 history through the proxy: native rows, or one jetton's transfers. null = no usable answer. */
export async function proxyTonHistory(chain: Pick<Chain, "name">, address: string,
  asset: { decimals: number; symbol: string; isNative: boolean; contractAddress?: string | null }): Promise<Transaction[] | null> {
  const network = proxyNetwork(chain);
  const raw = tonRaw(address);
  const jetton = !asset.isNative && asset.contractAddress ? tonRaw(asset.contractAddress) : null;
  if (!network || !raw || (!asset.isNative && !jetton)) return null;
  const r = await proxyPost(network, "history", jetton ? { address: raw, jetton } : { address: raw });
  if (r?.status !== 200 || r.body.address !== raw) return null;
  try {
    if (jetton) {
      if (!Array.isArray(r.body.transfers)) return null;
      const rows = r.body.transfers as (JettonTransferRow & { out?: unknown })[];
      return tonJettonTransactions(rows.slice(0, 20), asset, (t) => (t as { out?: unknown }).out === true);
    }
    if (!Array.isArray(r.body.transactions)) return null;
    return tonNativeTransactions((r.body.transactions as TonTxRow[]).slice(0, 20), asset);
  } catch {
    return null; // a malformed value (BigInt) = no answer
  }
}

/** Destination of a signed external message BOC (the wallet that sends it), raw form; null when unreadable. */
function externalDest(bocBase64: string): string | null {
  try {
    const msg = loadMessage(Cell.fromBoc(Buffer.from(bocBase64, "base64"))[0].beginParse());
    return msg.info.type === "external-in" ? msg.info.dest.toRawString() : null;
  } catch {
    return null;
  }
}

/**
 * Broadcast: toncenter first; when it failed, the proxy relays the same message (the server checks it is addressed
 * to one of this account's wallets). Sending one external message twice is harmless: the wallet's seqno lets it
 * through once. A node rejection through the proxy is final and reported; any other proxy failure rethrows the
 * public error.
 */
export async function broadcastTonWithProxyFallback(chain: Pick<Chain, "name">, bocBase64: string,
  publicBroadcast: () => Promise<string>): Promise<string> {
  try {
    return await publicBroadcast();
  } catch (err) {
    if (err instanceof TonNodeRejected) throw err;
    const network = proxyNetwork(chain);
    const address = externalDest(bocBase64);
    const r = network && address ? await proxyPost(network, "broadcast", { address, boc: bocBase64 }) : null;
    if (r?.status === 200 && r.body.sent === true && r.body.address === address) return tonMessageHash(bocBase64);
    if (r?.status === 422 && typeof r.body.reason === "string") {
      // Rate limited = toncenter never took it, so the node's rejection is the answer. Any other public failure may
      // have sent it already (the relay is then refused for the used seqno): neither success nor a plain failure.
      if (/rate limited/i.test(String((err as Error)?.message))) throw new Error(`TON broadcast failed: ${r.body.reason}`);
      throw new Error(`TON broadcast: the first attempt may have been sent (${r.body.reason}). Check the activity before sending again.`);
    }
    throw err;
  }
}
