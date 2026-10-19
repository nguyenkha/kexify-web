// Signer registry client (phase 2): silent register, /sign/init fields, list / activate / revoke.
// Phase 3: a passkey hand-over waits out a cooling period; the signing device can decline it.
// Routes: /api/keys/<keyShareId>/signers/* with the wallet's workspace token.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { apiUrl } from "./apiBase";
import { getToken } from "./auth";
import { workspaceHeaders } from "./workspace-token";
import { handleSessionEnded } from "./session-ended";
import { sha256Hex, authenticatePasskey, passkeyHeader } from "./passkey";
import { clientKeys } from "./client-key-cache";
import { clientScalarFromHandle } from "./unfreeze-share-proof";
import {
  clearLocalSignerId, deviceSign, getOrCreateSignerRecord, getSignerRecord, registerMessage, setLocalSignerState,
  signMessage, signerActionMessage, signerStorage, spkiFingerprint, volatileKeys, type SignerRecord,
} from "./device-signer-key";

export interface SignerRow {
  id: string; kind: string; label: string | null; status: "active" | "pending" | "revoked";
  addedVia: string; activeFrom: string | null; createdAt: string; lastUsedAt: string | null;
  revokedAt: string | null; revokeReason: string | null;
  /** Pending and waiting out a move started by a passkey (until activeFrom). */
  cooling?: boolean;
  /** Server-checked facts of the login that registered it (GET list only). */
  device?: { label?: string | null; platform: "web" | "ios" | "cli" | null; country: string | null; loginAt: string | null };
}

export class SignerApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.name = "SignerApiError"; this.status = status; this.code = code; }
}

async function call<T>(keyShareId: string, path: string, method: "GET" | "POST", body?: unknown, extra?: Record<string, string>): Promise<T> {
  const res = await fetch(apiUrl(`/api/keys/${encodeURIComponent(keyShareId)}/signers${path}`), {
    method,
    headers: { "Content-Type": "application/json", ...(await workspaceHeaders(keyShareId)), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleSessionEnded(res.status, data?.code); // this login is over (e.g. after a decline): sign out
    throw new SignerApiError(res.status, String(data?.code ?? data?.error ?? res.status));
  }
  return data as T;
}

/** "Chrome on macOS" from the user agent. */
export function webDeviceLabel(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** A login token exists. sessionStorage can be missing (tests) or throw (blocked storage). */
function signedIn(): boolean {
  try { return !!getToken(); } catch { return false; }
}

const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const inflight = new Map<string, Promise<SignerRecord | null>>();

async function register(keyShareId: string): Promise<SignerRecord | null> {
  const entry = clientKeys.get(keyShareId);
  if (!entry?.ecdsa) return null; // client share not in memory: register at the next unlock
  if (!signedIn()) return null; // no login yet (or tests): nothing to register with, and the handle stays unpinned
  clientKeys.pin(keyShareId); // the handle must outlive the awaits below
  try {
    const rec = await getOrCreateSignerRecord(keyShareId); // resolves once the key is persisted
    // A key that cannot be kept (IndexedDB unusable) must not take the slot: it would be gone after a reload.
    if (volatileKeys.has(keyShareId) && !signerStorage.allowMemoryOnly) return null;
    const { challengeId, challenge } = await call<{ challengeId: string; challenge: string }>(
      keyShareId, "/challenge", "POST", { pubkey: rec.spki, kind: "web_webcrypto" });
    const msg = registerMessage(keyShareId, await spkiFingerprint(rec.spki), challenge); // built locally, not the server's text
    const x1 = await clientScalarFromHandle(entry.mpc, entry.ecdsa);
    let shareProof: string;
    try { shareProof = hexOf(secp256k1.sign(msg, x1)); } finally { x1.fill(0); }
    const deviceSig = await deviceSign(rec, msg);
    const { signer } = await call<{ signer: SignerRow }>(keyShareId, "", "POST", { challengeId, shareProof, deviceSig, label: webDeviceLabel() });
    // Only for the key that was registered: another tab may have replaced the record meanwhile.
    await setLocalSignerState(keyShareId, { signerId: signer.id, status: signer.status }, rec.spki);
    const now = await getSignerRecord(keyShareId);
    return now?.spki === rec.spki ? now : null;
  } finally {
    clientKeys.unpin(keyShareId);
  }
}

/** Register this browser's key for the workspace unless it already has a live signer. Never throws. */
export async function ensureSigner(keyShareId: string): Promise<SignerRecord | null> {
  try {
    const have = await getSignerRecord(keyShareId);
    if (have?.signerId && have.status !== "revoked") return have;
    let p = inflight.get(keyShareId);
    if (!p) {
      p = register(keyShareId).finally(() => inflight.delete(keyShareId));
      inflight.set(keyShareId, p);
    }
    return await p;
  } catch {
    return null; // cold vault, offline, frozen: signing falls back to what the server decides
  }
}

/** Fields for /sign/init: nonce right before init, device sig over the digests of the `data` strings sent. */
export async function signerFieldsForInit(keyShareId: string, dataB64: string[]): Promise<Record<string, string> | null> {
  const rec = await ensureSigner(keyShareId);
  if (!rec?.signerId) return null;
  const { nonce } = await call<{ nonce: string }>(keyShareId, "/nonce", "POST");
  const digests = await Promise.all(dataB64.map(sha256Hex));
  const signerSig = await deviceSign(rec, signMessage(keyShareId, nonce, digests));
  return { signerId: rec.signerId, signerNonce: nonce, signerSig };
}

/** The server refused this device at /sign/init: remember it is View only here. */
export async function noteSignerRefused(keyShareId: string, code: string): Promise<void> {
  const rec = await getSignerRecord(keyShareId);
  if (!rec) return;
  if (code === "SIGNER_UNKNOWN") { await clearLocalSignerId(keyShareId, rec.spki); return; } // stale id: a fresh registration follows
  if (!/^SIGNER_(REVOKED|NOT_ACTIVE|REQUIRED)$/.test(code)) return;
  await setLocalSignerState(keyShareId, { status: code === "SIGNER_REVOKED" ? "revoked" : "pending" }, rec.spki);
}

/**
 * Signer fields + passkey ticket for one /sign/init. Normal order: nonce + device sig, then the ticket (a signer
 * error costs no tap). When the share is still PRF-locked and this device has no signer yet, the ticket (which
 * unlocks the share) comes first, then register, then nonce + sig. A device that registers as pending stops here.
 */
export async function authorizeWithSigner<T>(opts: {
  keyShareId: string; dataB64: string[]; shareLocked: boolean; getTicket: () => Promise<T>;
}): Promise<{ fields: Record<string, string>; ticket: T }> {
  const { keyShareId, dataB64, shareLocked, getTicket } = opts;
  const rec = await getSignerRecord(keyShareId);
  const noSigner = !rec?.signerId || rec.status === "revoked";
  if (!(shareLocked && noSigner)) {
    const fields = (await signerFieldsForInit(keyShareId, dataB64).catch(() => null)) ?? {};
    return { fields, ticket: await getTicket() };
  }
  const ticket = await getTicket(); // unlocks the share
  const reg = await ensureSigner(keyShareId);
  if (reg?.signerId && reg.status !== "active") {
    throw Object.assign(new Error("SIGNER_NOT_ACTIVE"), { status: 403, code: "SIGNER_NOT_ACTIVE" });
  }
  const fields = (await signerFieldsForInit(keyShareId, dataB64).catch(() => null)) ?? {};
  return { fields, ticket };
}

/** "Use this device": a revoked or missing key is replaced by a NEW key first, then that new id is activated. */
export async function takeOverSigning(keyShareId: string): Promise<void> {
  const rec = await ensureSigner(keyShareId);
  if (!rec?.signerId) throw new SignerApiError(0, "NO_SIGNER");
  if (rec.status === "active") return;
  await activateSigner(keyShareId, rec.signerId);
}

/** Fresh nonce + device sig for a retry after SIGNER_NONCE (same digests). */
export const freshSignerFields = (keyShareId: string, dataB64: string[]) => signerFieldsForInit(keyShareId, dataB64);

export async function listSigners(keyShareId: string): Promise<SignerRow[]> {
  const { signers } = await call<{ signers: SignerRow[] }>(keyShareId, "", "GET");
  const rec = await getSignerRecord(keyShareId);
  const mine = rec?.signerId ? signers.find((s) => s.id === rec.signerId) : undefined;
  if (rec && mine && mine.status !== rec.status) await setLocalSignerState(keyShareId, { status: mine.status }, rec.spki);
  return signers;
}

/** `{ by, nonce, sig }` from this device's key over the message for a fresh nonce; null without a signer id. */
export async function deviceAuth(keyShareId: string, message: (nonce: string) => Uint8Array): Promise<{ by: string; nonce: string; sig: string } | null> {
  const rec = await getSignerRecord(keyShareId);
  if (!rec?.signerId) return null;
  const { nonce } = await call<{ nonce: string }>(keyShareId, "/nonce", "POST");
  return { by: rec.signerId, nonce, sig: await deviceSign(rec, message(nonce)) };
}

/**
 * Hand signing to a pending signer. From the active device (its key): at once. By a passkey: the row comes back
 * pending with cooling + activeFrom (the move completes after the wait); 409 COOLING_IN_PROGRESS when another
 * device is already waiting. Returns the signer as the server answered.
 */
export async function activateSigner(keyShareId: string, targetId: string, fromActive?: boolean): Promise<SignerRow | undefined> {
  const path = `/${encodeURIComponent(targetId)}/activate`;
  const auth = fromActive ? await deviceAuth(keyShareId, (n) => signerActionMessage("activate", keyShareId, targetId, n)) : null;
  let out: { signer?: SignerRow };
  if (auth) {
    out = await call(keyShareId, path, "POST", auth);
  } else {
    const { token } = await authenticatePasskey({ action: { action: "signer.activate", keyShareId, signerId: targetId } });
    out = await call(keyShareId, path, "POST", {}, passkeyHeader(token));
  }
  await listSigners(keyShareId);
  return out?.signer;
}

/**
 * "No, stop it": the active device refuses a pending one. The server revokes it, removes the passkey that started
 * the move and, for an account, freezes it and ends every session (this one too): `frozen` says so.
 */
export async function declineSigner(keyShareId: string, targetId: string): Promise<{ signer?: SignerRow; frozen: boolean }> {
  const auth = await deviceAuth(keyShareId, (n) => signerActionMessage("decline", keyShareId, targetId, n));
  if (!auth) throw new SignerApiError(0, "NO_SIGNER");
  const out = await call<{ signer?: SignerRow; frozen?: boolean }>(keyShareId, `/${encodeURIComponent(targetId)}/decline`, "POST", auth);
  return { signer: out.signer, frozen: !!out.frozen };
}

/**
 * Remove a signer. Throws SignerApiError LAST_SIGNER_CONFIRM / LAST_SIGNER_NO_BACKUP for the last one
 * (the server answers those before it checks the passkey, so the first try carries no ticket and costs no tap).
 */
export async function revokeSigner(keyShareId: string, targetId: string, opts: { viaDevice?: boolean; confirmLast?: boolean } = {}): Promise<void> {
  const rec = await getSignerRecord(keyShareId);
  const path = `/${encodeURIComponent(targetId)}/revoke`;
  const confirm = opts.confirmLast ? { confirmLast: true } : {};
  const auth = opts.viaDevice ? await deviceAuth(keyShareId, (n) => signerActionMessage("revoke", keyShareId, targetId, n)) : null;
  if (auth) {
    await call(keyShareId, path, "POST", { ...confirm, ...auth });
  } else {
    try {
      await call(keyShareId, path, "POST", confirm);
    } catch (err) {
      if (!(err instanceof SignerApiError) || err.status !== 401 || /^session_/.test(err.code)) throw err;
      const { token } = await authenticatePasskey({ action: { action: "signer.revoke", keyShareId, signerId: targetId } });
      await call(keyShareId, path, "POST", confirm, passkeyHeader(token));
    }
  }
  if (rec?.signerId === targetId) await setLocalSignerState(keyShareId, { status: "revoked" }, rec.spki);
}

/** A fresh single-use signer nonce for this workspace (device move and refresh steps). */
export async function fetchSignerNonce(keyShareId: string): Promise<string> {
  return (await call<{ nonce: string }>(keyShareId, "/nonce", "POST")).nonce;
}
