// Lost-device restore (phase 4b, "I don't have it"): register a NEW device key on a passkey ticket bound to it
// (signer.restore), wait out the cooling, then - once this device is the active signer - open the server
// backup (one passkey ceremony) and do the same re-key + backup + commit as a QR move.
import { apiUrl } from "../apiBase";
import { newKeyRecord, putSignerRecord, deviceSign, registerMessage, spkiFingerprint } from "../device-signer-key";
import { downloadEscrow, type EscrowBlob } from "../escrow-download";
export { blobNeedsPassword, decryptRestoreBackup } from "./move-restore-backup";
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

/** The backup as this device may open it (one passkey ceremony; also reads PRF). */
export const openRestoreBackup = (keyShareId: string, opts: { passwordOnly?: boolean } = {}): Promise<EscrowBlob> => downloadEscrow(keyShareId, opts);

/** A restore this browser started and has not finished (its device key is the signer, but no copy is here yet). */
const flag = (id: string) => `kx-restore:${id}`;
export function restorePending(id: string): boolean {
  try { return localStorage.getItem(flag(id)) === "1"; } catch { return false; }
}
export function markRestorePending(id: string, on: boolean): void {
  try { if (on) localStorage.setItem(flag(id), "1"); else localStorage.removeItem(flag(id)); } catch { /* storage blocked */ }
}
