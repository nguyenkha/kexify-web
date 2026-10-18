// Per-wallet address book KEKs, derived when a client share is unlocked for signing.
//
// Fed wherever a client share is in hand: mpc.restoreKeyHandles (passphrase, uploaded key file, recovery),
// keystore's PRF byte path and its save/decrypt helpers (keygen, import, unlock). Only the derived KEK is
// kept (in memory, for this page load); it opens nothing but the address book key wrap of that one wallet.

import { deriveKek, deriveKekFromAscii } from "./address-book-sync-crypto";

const keks = new Map<string, Uint8Array>();
const listeners = new Set<() => void>();

/** `ecdsaShare`: the share string, or its ASCII bytes (the PRF byte path, keystore.getKeySharePartsWithPrf). */
export function noteUnlockedShare(keyShareId: string, ecdsaShare: string | Uint8Array): void {
  try {
    if (!keyShareId || !ecdsaShare.length) return;
    const kek = typeof ecdsaShare === "string" ? deriveKek(ecdsaShare, keyShareId) : deriveKekFromAscii(ecdsaShare, keyShareId);
    const old = keks.get(keyShareId);
    if (old && old.every((b, i) => b === kek[i])) { kek.fill(0); return; }
    // New wallet, or the same wallet with a new share (reshare): the old KEK no longer matches its wrap.
    old?.fill(0); // rounds hold their own copies
    keks.set(keyShareId, kek);
    for (const l of listeners) l();
  } catch { /* never let address book sync get in the way of signing */ }
}

export function availableKeks(): ReadonlyMap<string, Uint8Array> {
  return keks;
}

export function onKekAdded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Sign out: wipe and drop every KEK (a round in flight holds its own copies, address-book-sync.ts). */
export function clearKeks(): void {
  for (const k of keks.values()) k.fill(0);
  keks.clear();
}
