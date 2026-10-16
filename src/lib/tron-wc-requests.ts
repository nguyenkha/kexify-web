// WalletConnect TRON (Reown TRON RPC reference) request / response shapes for the web wallet. Same rules as the iOS
// wallet (ios/KexifyCore WalletConnectCall.swift): tron_signTransaction takes the v1 flat transaction or the legacy
// nested `transaction.transaction`, and answers with the signed transaction object (the dApp broadcasts it);
// tron_signMessage takes a plain-text message and answers `{ signature }`. The web signs on TRON mainnet only.

import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "../shared/utils";
import type { TronTransaction } from "./chains/tronTx";
import { decodeTronRawData, type TronDecodedTx } from "./chains/tron-raw-data-decoder";

/** CAIP-2 id of TRON mainnet (last 4 bytes of the genesis block id). Nile is tron:0xcd8690dc. */
export const TRON_MAINNET_CHAIN = "tron:0x2b6653dc";

type Namespaces = Record<string, { chains?: string[] } | undefined> | undefined;

/** TRON chain ids a proposal lists, from `tron.chains` and from chain-scoped keys like "tron:0x2b6653dc". */
function tronChains(namespaces: Namespaces): string[] {
  const out: string[] = [];
  for (const [key, ns] of Object.entries(namespaces ?? {})) {
    if (key === "tron") out.push(...(ns?.chains ?? []));
    else if (key.startsWith("tron:")) out.push(key);
  }
  return out;
}

export type TronProposalSupport =
  | { ok: true; offerAccounts: boolean }
  | { ok: false; unsupportedChains: string[] };

/**
 * A proposal that REQUIRES a TRON chain other than mainnet cannot be served (the same key would sign on mainnet);
 * it is refused with the chain ids named. Optional non-mainnet chains are just left out. TRON accounts are offered
 * only when mainnet is requested.
 */
export function tronProposalSupport(required: Namespaces, optional: Namespaces): TronProposalSupport {
  const req = tronChains(required);
  const unsupported = [...new Set(req.filter((c) => c !== TRON_MAINNET_CHAIN))];
  if (unsupported.length > 0) return { ok: false, unsupportedChains: unsupported };
  return { ok: true, offerAccounts: [...req, ...tronChains(optional)].includes(TRON_MAINNET_CHAIN) };
}

export class TronRequestError extends Error {}

const isHex = (s: unknown, len?: number): s is string =>
  typeof s === "string" && s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s) && (len === undefined || s.length === len);

/** A request is only signed for the chain the session was approved on: TRON mainnet. */
export function assertTronMainnet(chainId: string | undefined): void {
  if (chainId !== TRON_MAINNET_CHAIN) throw new TronRequestError(`Unsupported TRON chain ${chainId ?? "(none)"}: Kexify web signs on TRON mainnet only`);
}

export interface TronSignTransactionRequest {
  tx: TronTransaction;
  /** What the signed bytes do, read from raw_data_hex (never from the dApp's JSON raw_data). */
  decoded: TronDecodedTx;
}

/**
 * tron_signTransaction params → the transaction to sign. txID must be sha256(raw_data_hex), the bytes must read as
 * one TRX / TRC-20 transfer or TRC-20 approve owned by `account`, and `address` (when sent) must be `account`.
 */
export function parseTronSignTransaction(params: unknown, account: string): TronSignTransactionRequest {
  const p = params as { address?: unknown; transaction?: Record<string, unknown> } | null;
  if (!p || typeof p !== "object") throw new TronRequestError("Missing params");
  if (p.address !== undefined && p.address !== account) throw new TronRequestError("Request address is not this account");
  let t = p.transaction;
  if (t && t.raw_data_hex === undefined && t.transaction && typeof t.transaction === "object") t = t.transaction as Record<string, unknown>;
  if (!t || !isHex(t.txID, 64) || !isHex(t.raw_data_hex) || !t.raw_data || typeof t.raw_data !== "object") {
    throw new TronRequestError("Missing or malformed TRON transaction");
  }
  const raw = hexToBytes(t.raw_data_hex);
  if (bytesToHex(sha256(raw)) !== t.txID.toLowerCase()) throw new TronRequestError("TRON txID is not sha256(raw_data_hex)");
  const decoded = decodeTronRawData(raw);
  if (decoded.owner !== account) throw new TronRequestError("TRON transaction is not owned by this account");
  const tx = { ...t, txID: t.txID.toLowerCase(), raw_data_hex: t.raw_data_hex.toLowerCase() } as unknown as TronTransaction;
  return { tx, decoded };
}

/** tron_signMessage params → the UTF-8 bytes of the plain-text message. */
export function parseTronSignMessage(params: unknown, account: string): Uint8Array {
  const p = params as { address?: unknown; message?: unknown } | null;
  if (!p || typeof p.message !== "string" || p.message === "") throw new TronRequestError("Missing message");
  if (p.address !== undefined && p.address !== account) throw new TronRequestError("Request address is not this account");
  return new TextEncoder().encode(p.message);
}

/** keccak256("\x19TRON Signed Message:\n" + len + message): the digest the API re-derives for tron_signMessage. */
export function tronMessageHash(message: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode("\x19TRON Signed Message:\n" + message.length);
  const prefixed = new Uint8Array(prefix.length + message.length);
  prefixed.set(prefix, 0);
  prefixed.set(message, prefix.length);
  return keccak_256(prefixed);
}
