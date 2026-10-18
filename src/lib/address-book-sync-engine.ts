// Address book sync, one round: pull, open, merge, push with If-Match, retry on 409.
// IO is injected so the round is testable and the same steps run on iOS
// (KexifyCore AddressBookSyncEngine.swift).

import {
  encodeEnvelope, newAbk, openBody, parseEnvelope, sealBody, unwrapAbk, wrapAbk, type Envelope,
} from "./address-book-sync-crypto";
import { encodeBook, mergeRecords, parseBook, sameBook, type WireRecord } from "./address-book-sync-merge";

export const MAX_BLOB_CHARS = 64 * 1024;

export interface RemoteBook { version: number; blob: string | null }
export type PutResult = { ok: true; version: number } | { ok: false; conflict: RemoteBook };

/** What this device remembers between rounds, per account. */
export interface SyncState { sub: string; abk: Uint8Array; version: number }

export interface SyncIO {
  sub: string;
  get(): Promise<RemoteBook>;
  put(blob: string, expectedVersion: number): Promise<PutResult>;
  readLocal(): WireRecord[];
  /** Atomically: read the local book as it is now, store `next(it)`, return what was stored. */
  updateLocal(next: (fresh: WireRecord[]) => WireRecord[]): WireRecord[];
  loadState(): SyncState | null;
  saveState(s: SyncState): void;
  /** KEKs of unlocked wallets that belong to `sub`. */
  ownKeks(): Promise<ReadonlyMap<string, Uint8Array>>;
  now?: () => number;
}

/**
 * synced: local and server agree. locked: the server book exists but no key this device holds
 * opens it (unlock a wallet of this account). needs-unlock: nothing on the server yet and no
 * unlocked wallet to seal a new key to. too-large / conflict: not pushed, local kept.
 */
export type SyncStatus = "synced" | "locked" | "needs-unlock" | "too-large" | "conflict";

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function tryOpen(env: Envelope, abk: Uint8Array | undefined, keks: ReadonlyMap<string, Uint8Array>, sub: string) {
  if (abk) {
    try { return { abk, records: parseBook(await openBody(abk, env.ct, sub)) }; } catch { /* rotated or stale: try the wraps */ }
  }
  for (const [id, kek] of keks) {
    if (!env.wraps[id]) continue;
    try {
      const k = await unwrapAbk(kek, env.wraps[id], sub, id);
      return { abk: k, records: parseBook(await openBody(k, env.ct, sub)) };
    } catch { /* stale wrap (reshare) or not ours */ }
  }
  return null;
}

/** Wrap the key for every own wallet that has no working wrap yet. Returns true when wraps changed. */
async function refreshWraps(wraps: Record<string, string>, abk: Uint8Array, keks: ReadonlyMap<string, Uint8Array>, sub: string) {
  let changed = false;
  for (const [id, kek] of keks) {
    if (kek.length !== 32 || kek.every((b) => b === 0)) continue; // a wiped key never seals anything
    if (wraps[id]) {
      try { if (equalBytes(await unwrapAbk(kek, wraps[id], sub, id), abk)) continue; } catch { /* re-wrap below */ }
    }
    wraps[id] = await wrapAbk(kek, abk, sub, id);
    changed = true;
  }
  return changed;
}

export async function syncOnce(io: SyncIO): Promise<SyncStatus> {
  const now = io.now ?? Date.now;
  // The IO keys the state per account; one saved for another account is ignored, never trusted.
  const saved = io.loadState();
  const state = saved && saved.sub === io.sub ? saved : null;
  let local = io.readLocal();
  const keks = await io.ownKeks();
  let remote = await io.get();

  for (let attempt = 0; attempt < 4; attempt++) {
    let abk: Uint8Array;
    let records: WireRecord[] = [];
    let wraps: Record<string, string> = {};
    let ct: string | null = null;
    if (remote.blob) {
      const env = parseEnvelope(remote.blob);
      const opened = await tryOpen(env, state?.abk, keks, io.sub);
      if (!opened) return "locked";
      ({ abk, records } = opened);
      wraps = { ...env.wraps };
      ct = env.ct;
    } else {
      if (keks.size === 0) return "needs-unlock";
      abk = state?.abk ?? newAbk();
    }

    const wrapsChanged = await refreshWraps(wraps, abk, keks, io.sub);
    // A new book needs at least one wrap, or no other device could ever open it.
    if (!remote.blob && Object.keys(wraps).length === 0) return "needs-unlock";
    // Merge with the local book as it is now, not the snapshot from before the requests: an edit made
    // while a request was in flight is kept (and pushed by this round or the next).
    const merged = io.updateLocal((fresh) => mergeRecords([records, local, fresh], now()));

    const bodyChanged = !remote.blob || !sameBook(merged, records);
    if (!bodyChanged && !wrapsChanged) {
      io.saveState({ sub: io.sub, abk, version: remote.version });
      return "synced";
    }
    if (bodyChanged || !ct) ct = await sealBody(abk, encodeBook(merged), io.sub);
    const blob = encodeEnvelope(wraps, ct);
    if (blob.length > MAX_BLOB_CHARS) return "too-large";

    const res = await io.put(blob, remote.version);
    if (res.ok) {
      io.saveState({ sub: io.sub, abk, version: res.version });
      return "synced";
    }
    remote = res.conflict;
    local = merged;
  }
  return "conflict";
}
