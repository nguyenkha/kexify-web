// Solana balance-change preview from the standard `simulateTransaction` RPC (free on any node).
// Pre-state: getMultipleAccounts of the tx's writable accounts. Post-state: the same accounts returned by the
// simulation. The owner's SOL delta includes the fee and any rent; SPL deltas come from token accounts it owns.
// v0 address lookup tables are resolved through jsonParsed table accounts.

import { base58 } from "@scure/base";
import { formatBaseUnits } from "./tx-simulation-evm-parse";
import { simRpc, type KnownToken, type SimulatedChange, type SimulationResult } from "./txSimulation";

/** jsonParsed account as returned by getMultipleAccounts / simulateTransaction (null = account does not exist). */
export interface SolParsedAccount {
  lamports: number | string;
  data?: unknown;
}

interface TokenInfo { mint: string; owner: string; amount: bigint; decimals: number }

function tokenInfo(acc: SolParsedAccount | null | undefined): TokenInfo | null {
  const parsed = (acc?.data as { parsed?: { type?: string; info?: Record<string, unknown> } } | undefined)?.parsed;
  if (parsed?.type !== "account" || !parsed.info) return null;
  const info = parsed.info as { mint?: string; owner?: string; tokenAmount?: { amount?: string; decimals?: number } };
  if (!info.mint || !info.owner || info.tokenAmount?.amount == null) return null;
  return { mint: info.mint, owner: info.owner, amount: BigInt(info.tokenAmount.amount), decimals: info.tokenAmount.decimals ?? 0 };
}

export interface SolNetDelta {
  mint: string | null; // null = SOL
  decimals: number;
  delta: bigint;
}

/** Net SOL + SPL deltas for `owner` from matching pre/post account arrays (same order as `addresses`). */
export function parseSolanaSimulation(
  addresses: string[],
  pre: (SolParsedAccount | null)[],
  post: (SolParsedAccount | null)[],
  owner: string,
): SolNetDelta[] {
  const out: SolNetDelta[] = [];
  const tokens = new Map<string, SolNetDelta>();
  addresses.forEach((addr, i) => {
    const before = pre[i] ?? null;
    const after = post[i] ?? null;
    if (addr === owner) {
      const d = BigInt(after?.lamports ?? 0) - BigInt(before?.lamports ?? 0);
      if (d !== 0n) out.push({ mint: null, decimals: 9, delta: d });
      return;
    }
    const tb = tokenInfo(before);
    const ta = tokenInfo(after);
    const mineBefore = tb?.owner === owner;
    const mineAfter = ta?.owner === owner;
    if (!mineBefore && !mineAfter) return;
    const t = (mineAfter ? ta : tb)!;
    // A token account whose authority moves away from the user counts as leaving in full (and vice versa)
    const beforeAmt = mineBefore ? tb!.amount : 0n;
    const afterAmt = mineAfter ? ta!.amount : 0n;
    const cur = tokens.get(t.mint) ?? { mint: t.mint, decimals: t.decimals, delta: 0n };
    cur.delta += afterAmt - beforeAmt;
    tokens.set(t.mint, cur);
  });
  for (const t of tokens.values()) if (t.delta !== 0n) out.push(t);
  return out;
}

function readCompactU16(b: Uint8Array, off: number): [number, number] {
  let v = 0, n = 0;
  for (;;) {
    const byte = b[off + n];
    v |= (byte & 0x7f) << (7 * n);
    n++;
    if (!(byte & 0x80)) return [v, n];
  }
}

export interface WireAccounts {
  /** Writable static account keys */
  keys: string[];
  /** v0 address lookup tables and the writable indexes the tx loads from each */
  lookups: { table: string; writable: number[] }[];
}

/** Writable accounts of a wire-format transaction: static keys plus v0 lookup-table references. */
export function parseWireAccounts(tx: Uint8Array): WireAccounts {
  const [numSigs, sigLen] = readCompactU16(tx, 0);
  const msg = tx.subarray(sigLen + numSigs * 64);
  const versioned = (msg[0] & 0x80) !== 0;
  let off = versioned ? 1 : 0;
  const reqSigs = msg[off], roSigned = msg[off + 1], roUnsigned = msg[off + 2];
  off += 3;
  const [numKeys, keysLen] = readCompactU16(msg, off);
  off += keysLen;
  const keys: string[] = [];
  for (let i = 0; i < numKeys; i++) {
    const writable = i < reqSigs ? i < reqSigs - roSigned : i < numKeys - roUnsigned;
    if (writable) keys.push(base58.encode(msg.subarray(off + i * 32, off + i * 32 + 32)));
  }
  off += numKeys * 32 + 32; // keys + recent blockhash
  const lookups: WireAccounts["lookups"] = [];
  if (!versioned) return { keys, lookups };
  const [numIx, ixLen] = readCompactU16(msg, off);
  off += ixLen;
  for (let i = 0; i < numIx; i++) {
    off += 1; // program id index
    const [nAcc, l1] = readCompactU16(msg, off);
    off += l1 + nAcc;
    const [nData, l2] = readCompactU16(msg, off);
    off += l2 + nData;
  }
  const [numLookups, lkLen] = readCompactU16(msg, off);
  off += lkLen;
  for (let i = 0; i < numLookups; i++) {
    const table = base58.encode(msg.subarray(off, off + 32));
    off += 32;
    const [nW, lw] = readCompactU16(msg, off);
    off += lw;
    const writable = Array.from(msg.subarray(off, off + nW));
    off += nW;
    const [nR, lr] = readCompactU16(msg, off);
    off += lr + nR;
    if (off > msg.length) throw new Error("truncated lookup table section");
    lookups.push({ table, writable });
  }
  return { keys, lookups };
}

/** Writable static account keys of a wire-format transaction. */
export function writableStaticKeys(tx: Uint8Array): string[] {
  return parseWireAccounts(tx).keys;
}

/** jsonParsed address lookup table accounts (getMultipleAccounts value) -> the writable loaded addresses. Throws. */
export function lookupWritableAddresses(lookups: WireAccounts["lookups"], tables: unknown[]): string[] {
  return lookups.flatMap((l, i) => {
    const list = (tables[i] as { data?: { parsed?: { info?: { addresses?: string[] } } } } | null)?.data?.parsed?.info?.addresses;
    if (!list) throw new Error("lookup table not readable");
    return l.writable.map((idx) => {
      if (!list[idx]) throw new Error("lookup index out of range");
      return list[idx];
    });
  });
}

/** The accounts to compare: writable static + loaded keys, owner first when missing. */
export function solanaSimAddresses(keys: string[], loaded: string[], owner: string): string[] {
  const addresses = [...new Set([...keys, ...loaded])];
  if (!addresses.includes(owner)) addresses.unshift(owner);
  return addresses;
}

/**
 * getMultipleAccounts value (pre) + simulateTransaction value -> the owner's estimated changes (pure; the web and the
 * iOS chain bundle both use it). null when the responses are unusable.
 */
export function solanaSimResult(
  addresses: string[],
  pre: (SolParsedAccount | null)[] | undefined,
  sim: { err?: unknown; accounts?: (SolParsedAccount | null)[] } | undefined,
  owner: string,
  knownTokens: KnownToken[] = [],
): SimulationResult | null {
  if (!sim) return null;
  if (sim.err) return { changes: [], provider: "rpc", reverted: true };
  if (!pre || !sim.accounts) return null;
  const changes = parseSolanaSimulation(addresses, pre, sim.accounts, owner).map((d): SimulatedChange => {
    const k = d.mint ? knownTokens.find((t) => t.contractAddress === d.mint) : null;
    const symbol = d.mint === null ? "SOL" : k?.symbol ?? `${d.mint.slice(0, 4)}…${d.mint.slice(-4)}`;
    const abs = d.delta < 0n ? -d.delta : d.delta;
    return {
      asset: { symbol, contractAddress: d.mint, decimals: d.decimals, known: d.mint === null || !!k },
      amount: formatBaseUnits(abs, d.decimals),
      rawAmount: abs.toString(),
      direction: d.delta < 0n ? "out" : "in",
    };
  });
  return { changes, provider: "rpc", feeIncluded: true };
}

/** simulateTransaction params for a wire tx (sigVerify off, fresh blockhash, jsonParsed post-state of `addresses`). */
export function solanaSimParams(txBase64: string, addresses: string[]): unknown[] {
  return [txBase64, {
    encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed",
    accounts: { addresses, encoding: "jsonParsed" },
  }];
}

/** Wire tx with zeroed signature slots around an unsigned message (simulated with sigVerify: false). */
export function unsignedWireTx(message: Uint8Array): Uint8Array {
  const numSigs = message[0] & 0x80 ? message[1] : message[0];
  const tx = new Uint8Array(1 + numSigs * 64 + message.length);
  tx[0] = numSigs; // < 128 signers, so compact-u16 is one byte
  tx.set(message, 1 + numSigs * 64);
  return tx;
}

/**
 * Simulate a Solana transaction (wire bytes) and return the owner's estimated SOL / SPL changes.
 * Returns null on any failure so the caller keeps its static estimate.
 */
export async function simulateSolanaTransaction(
  rpcUrl: string,
  tx: Uint8Array,
  owner: string,
  knownTokens: KnownToken[] = [],
): Promise<SimulationResult | null> {
  try {
    const { keys, lookups } = parseWireAccounts(tx);
    // Unresolvable lookup tables throw: "could not simulate" beats a partial result that looks complete
    let loaded: string[] = [];
    if (lookups.length > 0) {
      const t = await simRpc(rpcUrl, "getMultipleAccounts", [lookups.map((l) => l.table), { encoding: "jsonParsed", commitment: "confirmed" }]);
      loaded = lookupWritableAddresses(lookups, (t as { value?: unknown[] })?.value ?? []);
    }
    const addresses = solanaSimAddresses(keys, loaded, owner);
    const [preRes, simRes] = await Promise.all([
      simRpc(rpcUrl, "getMultipleAccounts", [addresses, { encoding: "jsonParsed", commitment: "confirmed" }]),
      simRpc(rpcUrl, "simulateTransaction", solanaSimParams(btoa(String.fromCharCode(...tx)), addresses)),
    ]);
    return solanaSimResult(addresses, (preRes as { value?: (SolParsedAccount | null)[] })?.value,
      (simRes as { value?: { err?: unknown; accounts?: (SolParsedAccount | null)[] } })?.value, owner, knownTokens);
  } catch {
    return null;
  }
}
