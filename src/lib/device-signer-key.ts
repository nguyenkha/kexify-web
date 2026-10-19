// Device signer key (phase 2): one non-extractable P-256 key per workspace in this browser, kept in
// IndexedDB (CryptoKey objects are structured-cloneable). The messages it signs are built here from
// local values only, never from server-supplied text. Must match api/src/signer-verify.ts.

export interface SignerRecord {
  keyShareId: string;
  privateKey: CryptoKey;
  /** base64 SPKI DER of the public key. */
  spki: string;
  signerId?: string;
  /** Last known state of this device's signer for the workspace. */
  status?: "active" | "pending" | "revoked";
}

const DB_NAME = "kexify-device-signers";
const STORE = "keys";
const memory = new Map<string, SignerRecord>(); // no IndexedDB (tests, private modes, open failure)

/** Workspaces whose key lives in memory only (IndexedDB unusable): never registered, lost on reload. */
export const volatileKeys = new Set<string>();
/** Test seam: tests run without IndexedDB, so memory-only keys must be allowed to register there. */
export const signerStorage = { allowMemoryOnly: false };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "keyShareId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run one request; resolves only when the transaction COMPLETES (durable), rejects on error or abort. */
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      let result: T;
      // A listener, not onsuccess: run() may set its own onsuccess (compareAndPut does the put there).
      req.addEventListener("success", () => { result = req.result; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error ?? req.error);
      t.onabort = () => reject(t.error ?? new Error("indexeddb_aborted"));
    });
  } finally {
    db.close();
  }
}

const hasIdb = () => typeof indexedDB !== "undefined";

function announce(keyShareId: string) {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("kx-signer-changed", { detail: keyShareId }));
  }
}

export async function getSignerRecord(keyShareId: string): Promise<SignerRecord | null> {
  const mem = memory.get(keyShareId);
  if (mem) return mem;
  if (!hasIdb()) return null;
  try {
    return ((await tx("readonly", (s) => s.get(keyShareId))) as SignerRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Replace the record (state updates, or a new key after the old one was revoked). */
export async function putSignerRecord(rec: SignerRecord): Promise<void> {
  if (memory.has(rec.keyShareId) || !hasIdb()) {
    memory.set(rec.keyShareId, rec);
    if (!hasIdb()) volatileKeys.add(rec.keyShareId);
  } else {
    try {
      await tx("readwrite", (s) => s.put(rec));
    } catch {
      memory.set(rec.keyShareId, rec);
      volatileKeys.add(rec.keyShareId);
    }
  }
  announce(rec.keyShareId);
}

/**
 * Compare-and-put in ONE readwrite transaction: `next(current)` replaces the record only when the stored key is still
 * `expectedSpki` (two tabs cannot orphan each other's key). Returns what is stored afterwards, or null when there is none.
 */
async function compareAndPut(keyShareId: string, expectedSpki: string, next: (cur: SignerRecord) => SignerRecord): Promise<SignerRecord | null> {
  const mem = memory.get(keyShareId);
  if (mem || !hasIdb()) {
    if (!mem) return null;
    if (mem.spki !== expectedSpki) return mem;
    const n = next(mem);
    memory.set(keyShareId, n);
    announce(keyShareId);
    return n;
  }
  try {
    await tx("readwrite", (s) => {
      const req = s.get(keyShareId);
      req.onsuccess = () => {
        const cur = req.result as SignerRecord | undefined;
        if (cur && cur.spki === expectedSpki) s.put(next(cur));
      };
      return req;
    });
  } catch {
    return null;
  }
  const after = await getSignerRecord(keyShareId);
  if (after) announce(keyShareId);
  return after;
}

/** Insert only when no record exists; returns what is stored (the existing record on conflict, e.g. another tab won). */
async function addSignerRecord(rec: SignerRecord): Promise<SignerRecord> {
  if (!memory.has(rec.keyShareId) && hasIdb()) {
    try {
      await tx("readwrite", (s) => s.add(rec));
      announce(rec.keyShareId);
      return rec;
    } catch {
      const existing = await getSignerRecord(rec.keyShareId); // ConstraintError: another tab's key stays
      if (existing) return existing;
      volatileKeys.add(rec.keyShareId); // IndexedDB unusable: the key lives in memory for this session
    }
  }
  const existing = memory.get(rec.keyShareId);
  if (existing) return existing;
  memory.set(rec.keyShareId, rec);
  volatileKeys.add(rec.keyShareId); // memory-only: never registered
  announce(rec.keyShareId);
  return rec;
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buf as ArrayBuffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** A new non-extractable device key, not stored yet (device move: the workspace is known only after the claim). */
export async function newKeyRecord(keyShareId: string): Promise<SignerRecord> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { keyShareId, privateKey: kp.privateKey, spki: b64(await crypto.subtle.exportKey("spki", kp.publicKey)) };
}

/**
 * The record for a workspace, creating a fresh non-extractable key when this device has none (or only a revoked
 * one). Resolves once the key is persisted. A first key never overwrites another tab's (add, not put).
 */
export async function getOrCreateSignerRecord(keyShareId: string): Promise<SignerRecord> {
  const have = await getSignerRecord(keyShareId);
  if (have && have.status !== "revoked") return have;
  const rec = await newKeyRecord(keyShareId);
  if (!have) return addSignerRecord(rec);
  // Replaces the revoked key only if it is still the one we saw (another tab may have replaced it already).
  const stored = await compareAndPut(keyShareId, have.spki, () => rec);
  return stored ?? rec;
}

/** Remember what the server says about this device's signer; only for the key `spki` (no-op on mismatch). */
export async function setLocalSignerState(
  keyShareId: string,
  patch: { signerId?: string; status?: "active" | "pending" | "revoked" },
  spki: string,
): Promise<void> {
  await compareAndPut(keyShareId, spki, (cur) => ({ ...cur, ...patch }));
}

/** Forget a signer id the server does not know (the key `spki` stays and registers again). */
export async function clearLocalSignerId(keyShareId: string, spki: string): Promise<void> {
  await compareAndPut(keyShareId, spki, (cur) => ({ keyShareId, privateKey: cur.privateKey, spki: cur.spki }));
}

// ── Messages (UTF-8) ──

const enc = (s: string) => new TextEncoder().encode(s);

export async function spkiFingerprint(spkiB64: string): Promise<string> {
  const der = Uint8Array.from(atob(spkiB64), (c) => c.charCodeAt(0));
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
  return Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("");
}

export const registerMessage = (keyShareId: string, fingerprint: string, challengeHex: string) =>
  enc(`kexify-signer:v1:register:${keyShareId}:${fingerprint}:${challengeHex}`);

export const signMessage = (keyShareId: string, nonce: string, digests: string[]) =>
  enc(`kexify-signer:v1:sign:${keyShareId}:${nonce}:${digests.join(",")}`);

export const signerActionMessage = (action: "activate" | "revoke" | "decline", keyShareId: string, targetId: string, nonce: string) =>
  enc(`kexify-signer:v1:${action}:${keyShareId}:${targetId}:${nonce}`);

/** Alert email change by the signing device; `emailSha256` is "none" when removing it. */
export const alertEmailMessage = (keyShareId: string, emailSha256: string, nonce: string) =>
  enc(`kexify-signer:v1:alert-email:${keyShareId}:${emailSha256}:${nonce}`);

/** ECDSA P-256 / SHA-256 over `message`; base64 of the raw 64-byte r||s. */
export async function deviceSign(rec: SignerRecord, message: Uint8Array): Promise<string> {
  return b64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, rec.privateKey, message as BufferSource));
}
