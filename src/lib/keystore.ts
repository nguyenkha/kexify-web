// Browser key share storage using localStorage
// Encrypted with passkey PRF-derived key or passphrase fallback

import type { KeyFileData } from "./crypto";
import { toBase64, fromBase64, DEFERRED_PRF_SHARE } from "./mpc";
import { linkKeyShareToSite } from "./key-share-site-link";
import { findJsonStringField, sharePartsFromAscii, wipe } from "./secret-bytes";
import { noteUnlockedShare } from "./address-book-kek";

const STORAGE_PREFIX = "keyshare:";

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

// ── Storage preference ───────────────────────────────────────────

const PREF_KEY = "keyshare_pref";

export function getStoragePreference(): "browser" | "file" {
  return localStorage.getItem(PREF_KEY) === "browser" ? "browser" : "file";
}

export function setStoragePreference(pref: "browser" | "file") {
  localStorage.setItem(PREF_KEY, pref);
}

// ── Stored shape ─────────────────────────────────────────────────

interface StoredShare {
  keyId: string;
  mode: "prf" | "passphrase";
  type?: "email" | "standalone"; // defaults to "email" for backward compat
  credentialId?: string;
  salt?: string; // base64, for passphrase mode
  iv: string; // base64
  ciphertext: string; // base64
  meta: {
    publicKey: string;
    /** Public; lets a PRF share stay locked until the signing tap (deferredPrfKeyFile). */
    eddsaPublicKey?: string;
    peer?: number;
    storedAt: string;
    name?: string;
  };
}

function lsKey(keyId: string): string {
  return STORAGE_PREFIX + keyId;
}

function lsGet(keyId: string): StoredShare | null {
  const raw = localStorage.getItem(lsKey(keyId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function lsPut(value: StoredShare): void {
  localStorage.setItem(lsKey(value.keyId), JSON.stringify(value));
}

function lsDelete(keyId: string): void {
  localStorage.removeItem(lsKey(keyId));
}

function lsGetAll(): StoredShare[] {
  const results: StoredShare[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(STORAGE_PREFIX)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k)!);
      if (v?.keyId) results.push(v);
    } catch { /* skip */ }
  }
  return results;
}

// ── Encryption helpers ────────────────────────────────────────────

function serialize(data: KeyFileData): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

/** Parse a decrypted key file and wipe the plaintext bytes (the parsed strings remain). */
function deserialize(buf: Uint8Array): KeyFileData {
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } finally {
    wipe(buf);
  }
}

/** Decoded client share, never turned into a string. The caller wipes `ecdsa` / `eddsa`. */
export interface KeyShareParts {
  ecdsa: Uint8Array[];
  eddsa: Uint8Array[];
  /** The rest of the key file, with share values blanked. */
  meta: KeyFileData;
}

/**
 * Like deserialize, but the share fields go bytes -> decoded parts, and only the
 * non-secret rest of the JSON becomes strings. Wipes `buf`.
 */
function deserializeParts(buf: Uint8Array): KeyShareParts {
  const parts: KeyShareParts = { ecdsa: [], eddsa: [], meta: null as unknown as KeyFileData };
  try {
    const ecdsaAt = findJsonStringField(buf, "share");
    const eddsaAt = findJsonStringField(buf, "eddsaShare");
    if (ecdsaAt) parts.ecdsa = sharePartsFromAscii(buf.subarray(...ecdsaAt));
    if (eddsaAt) parts.eddsa = sharePartsFromAscii(buf.subarray(...eddsaAt));
    // Spaces are valid string content: blank the secrets in place, then parse the rest.
    if (ecdsaAt) buf.fill(0x20, ...ecdsaAt);
    if (eddsaAt) buf.fill(0x20, ...eddsaAt);
    parts.meta = JSON.parse(new TextDecoder().decode(buf));
    parts.meta.share = "";
    parts.meta.eddsaShare = "";
    return parts;
  } catch (err) {
    wipe(parts.ecdsa, parts.eddsa);
    throw err;
  } finally {
    wipe(buf);
  }
}

// Helper to convert Uint8Array to ArrayBuffer (avoids TS BufferSource issues)
function toAB(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toAB(iv) }, key, toAB(plaintext));
  return {
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted)),
  };
}

async function aesDecrypt(key: CryptoKey, iv: string, ciphertext: string): Promise<Uint8Array> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toAB(fromBase64(iv)) },
    key,
    toAB(fromBase64(ciphertext)),
  );
  return new Uint8Array(decrypted);
}

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(passphrase);
  const baseKey = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toAB(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Public API ────────────────────────────────────────────────────

export async function saveKeyShareWithPrf(
  keyId: string,
  data: KeyFileData,
  prfKey: CryptoKey,
  credentialId: string,
  type: "email" | "standalone" = "email",
): Promise<void> {
  noteUnlockedShare(data.id, data.share); // a new or imported wallet: its address book sync KEK
  const plain = serialize(data);
  const { iv, ciphertext } = await aesEncrypt(prfKey, plain).finally(() => wipe(plain));
  lsPut({
    keyId,
    mode: "prf",
    type,
    credentialId,
    iv,
    ciphertext,
    meta: {
      publicKey: data.publicKey,
      eddsaPublicKey: data.eddsaPublicKey,
      peer: data.peer,
      storedAt: new Date().toISOString(),
    },
  });
  if (type === "email") {
    try {
      await linkKeyShareToSite(keyId);
    } catch (err) {
      // Not a wallet on this account — don't keep a share that can never be used here.
      lsDelete(keyId);
      throw err;
    }
  }
}

export async function saveKeyShareWithPassphrase(
  keyId: string,
  data: KeyFileData,
  passphrase: string,
  type: "email" | "standalone" = "email",
): Promise<void> {
  noteUnlockedShare(data.id, data.share); // a new or imported wallet: its address book sync KEK
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await derivePassphraseKey(passphrase, salt);
  const plain = serialize(data);
  const { iv, ciphertext } = await aesEncrypt(key, plain).finally(() => wipe(plain));
  lsPut({
    keyId,
    mode: "passphrase",
    type,
    salt: toBase64(salt),
    iv,
    ciphertext,
    meta: {
      publicKey: data.publicKey,
      storedAt: new Date().toISOString(),
    },
  });
  if (type === "email") {
    try {
      await linkKeyShareToSite(keyId);
    } catch (err) {
      // Not a wallet on this account — don't keep a share that can never be used here.
      lsDelete(keyId);
      throw err;
    }
  }
}

export async function getKeyShareWithPrf(keyId: string, prfKey: CryptoKey): Promise<KeyFileData | null> {
  const entry = lsGet(keyId);
  if (!entry || entry.mode !== "prf") return null;
  let data: KeyFileData;
  try {
    data = deserialize(await aesDecrypt(prfKey, entry.iv, entry.ciphertext));
  } catch {
    return null;
  }
  backfillPublicMeta(entry, data);
  noteUnlockedShare(keyId, data.share);
  return data;
}

/**
 * PRF unlock for signing: the share goes straight from the decrypted bytes into wipeable
 * parts (no share string). Null when the entry is missing or does not decrypt.
 */
export async function getKeySharePartsWithPrf(keyId: string, prfKey: CryptoKey): Promise<KeyShareParts | null> {
  const entry = lsGet(keyId);
  if (!entry || entry.mode !== "prf") return null;
  let plain: Uint8Array;
  try {
    plain = await aesDecrypt(prfKey, entry.iv, entry.ciphertext);
  } catch {
    return null;
  }
  // Address book sync KEK from the share's bytes, before deserializeParts wipes them (address-book-kek.ts).
  try {
    const shareAt = findJsonStringField(plain, "share");
    if (shareAt) noteUnlockedShare(keyId, plain.subarray(...shareAt));
  } catch { /* malformed: deserializeParts below throws and wipes */ }
  const parts = deserializeParts(plain);
  try {
    backfillPublicMeta(entry, parts.meta);
  } catch {
    // Only a metadata convenience (e.g. storage full): never drop the decoded share unwiped over it.
  }
  return parts;
}

// Shares stored before the public EdDSA key was kept in the clear: backfill it, so the
// next send can defer the unlock to its signing tap.
function backfillPublicMeta(entry: StoredShare, data: KeyFileData): void {
  if (entry.meta.eddsaPublicKey === undefined && data.eddsaPublicKey !== undefined) {
    lsPut({ ...entry, meta: { ...entry.meta, eddsaPublicKey: data.eddsaPublicKey ?? "", peer: data.peer } });
  }
}

/**
 * A key file whose PRF-encrypted share is not decrypted yet: built from the public
 * metadata, with a placeholder share. The passkey assertion that authorizes the
 * signature also returns PRF and unlocks it (sign-passkey-authorization.ts), so a send
 * is one tap. Null when the metadata lacks what the signer needs (older entries until
 * their next unlock): the caller then unlocks first (two taps, once).
 */
export function deferredPrfKeyFile(keyId: string, opts: { needsEddsa: boolean }): KeyFileData | null {
  const entry = lsGet(keyId);
  if (!entry || entry.mode !== "prf" || !entry.meta.publicKey) return null;
  const eddsaPublicKey = entry.meta.eddsaPublicKey;
  if (opts.needsEddsa && !eddsaPublicKey) return null;
  return {
    id: keyId, peer: entry.meta.peer ?? 0, publicKey: entry.meta.publicKey, eddsaPublicKey: eddsaPublicKey ?? "",
    share: DEFERRED_PRF_SHARE, eddsaShare: "",
  };
}

export async function getKeyShareWithPassphrase(keyId: string, passphrase: string): Promise<KeyFileData | null> {
  const entry = lsGet(keyId);
  if (!entry || entry.mode !== "passphrase" || !entry.salt) return null;
  const key = await derivePassphraseKey(passphrase, fromBase64(entry.salt));
  try {
    const data = deserialize(await aesDecrypt(key, entry.iv, entry.ciphertext));
    noteUnlockedShare(keyId, data.share);
    return data;
  } catch {
    throw new Error("Incorrect passphrase");
  }
}

export function hasKeyShare(keyId: string): boolean {
  return lsGet(keyId) !== null;
}

export function getKeyShareMode(keyId: string): "prf" | "passphrase" | null {
  return lsGet(keyId)?.mode ?? null;
}

export function deleteKeyShare(keyId: string): void {
  lsDelete(keyId);
}

export interface KeyShareInfo {
  keyId: string;
  publicKey: string;
  mode: "prf" | "passphrase";
  type: "email" | "standalone";
  storedAt: string;
  name?: string;
  credentialId?: string;
}

/** Decrypt a StoredShare blob (from server escrow) using a PRF key */
export async function getKeyShareFromStoredShare(
  stored: { mode: string; iv: string; ciphertext: string },
  prfKey: CryptoKey,
): Promise<KeyFileData | null> {
  try {
    return deserialize(await aesDecrypt(prfKey, stored.iv, stored.ciphertext));
  } catch {
    return null;
  }
}

export function listKeyShares(): KeyShareInfo[] {
  return lsGetAll().map((e) => ({
    keyId: e.keyId,
    publicKey: e.meta.publicKey,
    mode: e.mode,
    type: e.type ?? "email",
    storedAt: e.meta.storedAt,
    name: e.meta.name,
    credentialId: e.credentialId,
  }));
}

/** Get only standalone shares from localStorage */
export function getStandaloneShares(): KeyShareInfo[] {
  return listKeyShares().filter((s) => s.type === "standalone");
}

/** Remove corrupted or incomplete keyshare entries from localStorage */
export function cleanupStaleShares(): void {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k?.startsWith(STORAGE_PREFIX)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k)!);
      // Remove entries missing required fields
      if (!v?.keyId || !v?.iv || !v?.ciphertext) {
        localStorage.removeItem(k);
      }
    } catch {
      // Corrupted JSON — remove
      localStorage.removeItem(k);
    }
  }
}
