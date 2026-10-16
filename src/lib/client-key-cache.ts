// In-memory cache of deserialized client key handles (cb-mpc objects in WASM memory).
//
// A handle holds the client share in clear inside the WASM heap until it is freed, and
// cb-mpc's free zeroes it (BN_clear_free / secure_bzero). So every way out of this cache
// frees the handle: delete/clear, replacing an entry, an idle timeout, page hide and sign out.
// A handle in use by a signing run is pinned and freed only once the run releases it.

import type { CbMpc, Ecdsa2pKeyHandle, EcKey2pHandle } from "cb-mpc";

export interface ClientKeyHandles {
  mpc: CbMpc;
  ecdsa?: Ecdsa2pKeyHandle;
  eddsa?: EcKey2pHandle;
}

/** A handle not used for this long after a sign is freed. A send restores it from the key file again (cheap). */
export const CLIENT_KEY_IDLE_MS = 60_000;
/**
 * A handle no sign has used yet (restored for a send still building its tx, or kept after keygen) gets longer:
 * the send flows restore before building the tx and free in their own `finally`, so this only bounds leftovers.
 */
export const CLIENT_KEY_UNUSED_MS = 10 * 60_000;
const SWEEP_EVERY_MS = 15_000;

export function freeClientKeyHandles(entry: ClientKeyHandles): void {
  try { if (entry.ecdsa) entry.mpc.freeEcdsa2pKey(entry.ecdsa); } catch { /* already gone */ }
  try { if (entry.eddsa) entry.mpc.freeEcKey2p(entry.eddsa); } catch { /* already gone */ }
  entry.ecdsa = undefined;
  entry.eddsa = undefined;
}

/**
 * Map-compatible (has/get/set/delete stay as callers use them) with freeing on removal.
 * `now` is injectable for tests.
 */
export class ClientKeyCache extends Map<string, ClientKeyHandles> {
  private lastUsed = new Map<string, number>();
  private pins = new Map<string, number>();
  private signed = new Set<string>();
  private pendingFree = new Map<string, ClientKeyHandles[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  now: () => number = () => Date.now();

  override set(keyId: string, entry: ClientKeyHandles): this {
    const old = super.get(keyId);
    super.set(keyId, entry);
    if (old && old !== entry) this.release(keyId, old);
    this.touch(keyId);
    this.schedule();
    return this;
  }

  override delete(keyId: string): boolean {
    const entry = super.get(keyId);
    const had = super.delete(keyId);
    this.lastUsed.delete(keyId);
    this.signed.delete(keyId);
    if (entry) this.release(keyId, entry);
    if (this.size === 0) this.stop();
    return had;
  }

  override clear(): void {
    for (const keyId of [...this.keys()]) this.delete(keyId);
  }

  /** Mark a key as in use (a signing run). Its handle is not freed until unpin. */
  pin(keyId: string): void {
    this.pins.set(keyId, (this.pins.get(keyId) ?? 0) + 1);
    if (super.has(keyId)) this.signed.add(keyId);
    this.touch(keyId);
  }

  unpin(keyId: string): void {
    const n = (this.pins.get(keyId) ?? 0) - 1;
    if (n > 0) { this.pins.set(keyId, n); this.touch(keyId); return; }
    this.pins.delete(keyId);
    this.touch(keyId);
    const pending = this.pendingFree.get(keyId);
    if (pending) {
      this.pendingFree.delete(keyId);
      pending.forEach(freeClientKeyHandles);
    }
  }

  /** Free every idle handle (CLIENT_KEY_IDLE_MS after a sign, CLIENT_KEY_UNUSED_MS if none used it), or all unpinned ones. */
  sweep(opts: { all?: boolean } = {}): void {
    const now = this.now();
    for (const keyId of [...this.keys()]) {
      if (this.pins.has(keyId)) continue;
      const limit = this.signed.has(keyId) ? CLIENT_KEY_IDLE_MS : CLIENT_KEY_UNUSED_MS;
      if (opts.all || now - (this.lastUsed.get(keyId) ?? 0) >= limit) this.delete(keyId);
    }
  }

  private touch(keyId: string): void {
    if (super.has(keyId)) this.lastUsed.set(keyId, this.now());
  }

  private release(keyId: string, entry: ClientKeyHandles): void {
    if (this.pins.has(keyId)) {
      // A run may still use it (pins count per key, not per handle): free every retired entry when the last run ends.
      const list = this.pendingFree.get(keyId) ?? [];
      if (!list.includes(entry)) list.push(entry);
      this.pendingFree.set(keyId, list);
    } else {
      freeClientKeyHandles(entry);
    }
  }

  private schedule(): void {
    if (this.timer || typeof setInterval !== "function") return;
    this.timer = setInterval(() => this.sweep(), SWEEP_EVERY_MS);
  }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

export const clientKeys = new ClientKeyCache();

// Leaving the page (tab close, bfcache, mobile app switch that discards) drops every idle handle.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => clientKeys.sweep({ all: true }));
}
