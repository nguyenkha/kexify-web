// Lost-device restore (phase 4b, "I don't have it"): register a NEW device key on a passkey ticket bound to it
// (signer.restore), wait out the cooling, then - once this device is the active signer - open the server
// backup (one passkey ceremony) and do the same re-key + backup + commit as a QR move.
import { apiUrl } from "../apiBase";
import { newKeyRecord, putSignerRecord, deviceSign, registerMessage, spkiFingerprint } from "../device-signer-key";
import { downloadEscrow, type EscrowBlob } from "../escrow-download";
import { decryptRestoreBackup } from "./move-restore-backup";
export { blobNeedsPassword, decryptRestoreBackup } from "./move-restore-backup";
import type { KeyFileData } from "../crypto";
import { isEnvelopeV2 } from "../escrow-envelope-v2";
import { wipe } from "../secret-bytes";
import { walletPublicKey } from "./move-new-device";
import { authenticatePasskey, sensitiveHeadersFor } from "../passkey";
import { webDeviceLabel, type SignerRow } from "../signer-api";
import { MoveApiError } from "./move-api";

async function post<T>(keyShareId: string, path: string, body: unknown, ticket?: string): Promise<T> {
  const res = await fetch(apiUrl(`/api/keys/${encodeURIComponent(keyShareId)}/signers${path}`), {
    method: "POST", headers: await sensitiveHeadersFor(keyShareId, ticket), body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MoveApiError(res.status, String(data?.code ?? data?.error ?? res.status));
  return data as T;
}

/**
 * Start a restore on this device: a fresh device key (a key this browser registered before cannot be reused),
 * one passkey ceremony bound to it, and the cooling starts at once. Returns the waiting signer row.
 */
export async function startRestore(keyShareId: string): Promise<{ signer: SignerRow; passwordRequired: boolean }> {
  const rec = await newKeyRecord(keyShareId);
  const pubkeySha256 = await spkiFingerprint(rec.spki);
  const { challengeId, challenge } = await post<{ challengeId: string; challenge: string }>(keyShareId, "/challenge", { pubkey: rec.spki, kind: "web_webcrypto" });
  const deviceSig = await deviceSign(rec, registerMessage(keyShareId, pubkeySha256, challenge));
  const { token } = await authenticatePasskey({ action: { action: "signer.restore", keyShareId, pubkeySha256 } });
  const out = await post<{ signer: SignerRow; passwordRequired?: boolean }>(keyShareId, "/restore", { challengeId, deviceSig, label: webDeviceLabel() }, token);
  await putSignerRecord({ ...rec, signerId: out.signer.id, status: "pending" });
  markRestorePending(keyShareId, true);
  return { signer: out.signer, passwordRequired: !!out.passwordRequired };
}

/** The backup as this device may open it (one passkey ceremony; also reads PRF, both salts: wipe `escrowSecret`). */
export const openRestoreBackup = (keyShareId: string, opts: { passwordOnly?: boolean; keepEscrowSecret?: boolean } = {}): Promise<EscrowBlob> => downloadEscrow(keyShareId, opts);

/** A restore this browser started and has not finished (its device key is the signer, but no copy is here yet). */
const flag = (id: string) => `kx-restore:${id}`;
export function restorePending(id: string): boolean {
  try { return localStorage.getItem(flag(id)) === "1"; } catch { return false; }
}
export function markRestorePending(id: string, on: boolean): void {
  try { if (on) localStorage.setItem(flag(id), "1"); else localStorage.removeItem(flag(id)); } catch { /* storage blocked */ }
}

/**
 * Open a served blob if it is a v2 passkey envelope (checked against the wallet's public key); null otherwise or
 * when it does not open. Always wipes the blob's escrow secret, so callers call it right after the download.
 */
export async function takeV2Backup(keyShareId: string, blob: EscrowBlob): Promise<KeyFileData | null> {
  try {
    if (!isEnvelopeV2(blob.encryptedData) || !blob.escrowSecret) return null;
    const publicKey = await walletPublicKey(keyShareId);
    return await decryptRestoreBackup(keyShareId, { ...blob, publicKey }).catch(() => null);
  } finally {
    wipe(blob.escrowSecret);
    blob.escrowSecret = undefined;
  }
}

/**
 * A served blob opened as far as the passkey can: a v2 envelope that opens gives `keyFile`; one that does not is
 * replaced ONCE by the password backup only (`passwordOnly`, one more passkey tap), returned as `blob` with the
 * first assertion's PRF key kept for saving locally. Any other blob comes back as is. The escrow secret is wiped.
 */
export async function openPasskeyBackupOrPassword(keyShareId: string, blob: EscrowBlob): Promise<{ keyFile: KeyFileData | null; blob: EscrowBlob }> {
  if (!isEnvelopeV2(blob.encryptedData)) { wipe(blob.escrowSecret); blob.escrowSecret = undefined; return { keyFile: null, blob }; }
  const keyFile = await takeV2Backup(keyShareId, blob);
  if (keyFile) return { keyFile, blob };
  const pw = await downloadEscrow(keyShareId, { passwordOnly: true });
  return { keyFile: null, blob: { ...pw, prfKey: blob.prfKey, credentialId: blob.credentialId, rpId: blob.rpId } };
}
