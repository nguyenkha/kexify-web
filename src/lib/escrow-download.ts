// Server backup (escrow) of a wallet. The blob is served after one passkey ceremony (ticket backup.download,
// the same assertion also reads PRF): from GET /keys/:id/backup while the wallet has no signing device, else
// only from POST /keys/:id/backup/escrow by the ACTIVE signer (device signature). Status needs no blob.
import { apiUrl } from "./apiBase";
import { authenticatePasskey, sensitiveHeadersFor } from "./passkey";
import { deviceSign, getSignerRecord } from "./device-signer-key";
import { fetchSignerNonce } from "./signer-api";
import { workspaceHeaders } from "./workspace-token";
import { backupUploadMessage, escrowMessage } from "./device-move/move-signer-messages";
import { sha256HexOf, utf8 } from "./device-move/move-codec";

/** User text for a refused POST /keys/:id/backup, or "" for anything without its own line. */
export function backupUploadErrorText(data: { code?: unknown }, t: (k: string) => string): string {
  const code = String(data?.code ?? "");
  if (code === "SHARE_GENERATION_MISMATCH") return t("backup.old");
  if (code.startsWith("SIGNER_")) return t("backup.fromSigner");
  return "";
}

/**
 * Extra body fields for POST /keys/:id/backup: once the wallet has an active signer, only it may replace the
 * backup (device key over the blob's sha256). Empty when this browser is not the signing device (a wallet
 * with no signer yet needs none; otherwise the server answers SIGNER_*).
 */
export async function backupUploadSignerFields(keyShareId: string, encryptedData: string): Promise<Record<string, string>> {
  const rec = await getSignerRecord(keyShareId).catch(() => null);
  if (!rec?.signerId || rec.status !== "active") return {};
  const nonce = await fetchSignerNonce(keyShareId);
  const blobSha = await sha256HexOf(utf8(encryptedData));
  return { signerId: rec.signerId, nonce, sig: await deviceSign(rec, backupUploadMessage(keyShareId, blobSha, nonce)) };
}

export interface BackupStatus {
  hasBackup: boolean; mode: "prf" | "passphrase" | null; shareGeneration: number;
  /** false: the backup is from before the last device move and no longer works. */
  current: boolean; passkeys: number; password: boolean;
  /** The wallet's key version now, and the one a refresh in flight is making (null = none). */
  walletGeneration?: number; refreshPending?: number | null;
}

export async function fetchBackupStatus(keyShareId: string): Promise<BackupStatus | null> {
  const res = await fetch(apiUrl(`/api/keys/${encodeURIComponent(keyShareId)}/backup/status`), { headers: await workspaceHeaders(keyShareId) });
  return res.ok ? (await res.json().catch(() => null)) as BackupStatus | null : null;
}

export class EscrowError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string) { super(code); this.name = "EscrowError"; this.status = status; this.code = code; }
}

export interface EscrowBlob {
  encryptedData: string;
  source: "passkey" | "password";
  shareGeneration: number;
  current: boolean;
  /** From the same assertion (absent when the passkey has no PRF). */
  prfKey?: CryptoKey; credentialId?: string; rpId?: string;
}

async function read(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new EscrowError(res.status, String(data?.code ?? data?.error ?? res.status));
  return data as Record<string, unknown>;
}

/** One passkey ceremony, then the blob this device may open. Throws EscrowError (NO_BACKUP, ESCROW_SIGNER_REQUIRED, ...). */
export async function downloadEscrow(keyShareId: string, opts: { passwordOnly?: boolean } = {}): Promise<EscrowBlob> {
  const auth = await authenticatePasskey({ withPrf: !opts.passwordOnly, action: { action: "backup.download", keyShareId } });
  const extra = { prfKey: auth.prfKey, credentialId: auth.credentialId, rpId: auth.rpId };
  const id = encodeURIComponent(keyShareId);
  const rec = await getSignerRecord(keyShareId);
  if (!rec?.signerId || rec.status !== "active") {
    if (opts.passwordOnly) throw new EscrowError(403, "SIGNER_NOT_ACTIVE");
    // No signing device yet: the plain route (refused with ESCROW_SIGNER_REQUIRED once the wallet has one).
    const d = await read(await fetch(apiUrl(`/api/keys/${id}/backup`), { headers: await sensitiveHeadersFor(keyShareId, auth.token) }));
    if (typeof d.encryptedData !== "string" || !d.encryptedData) throw new EscrowError(404, "NO_BACKUP");
    const isPrf = (() => { try { return JSON.parse(d.encryptedData as string)?.mode === "prf"; } catch { return false; } })();
    return { encryptedData: d.encryptedData, source: isPrf ? "passkey" : "password", shareGeneration: Number(d.shareGeneration ?? 0), current: d.current !== false, ...extra };
  }
  const nonce = await fetchSignerNonce(keyShareId);
  const sig = await deviceSign(rec, escrowMessage(keyShareId, nonce));
  const d = await read(await fetch(apiUrl(`/api/keys/${id}/backup/escrow`), {
    method: "POST", headers: await sensitiveHeadersFor(keyShareId, auth.token), body: JSON.stringify({ signerId: rec.signerId, nonce, sig, ...(opts.passwordOnly ? { passwordOnly: true } : {}) }),
  }));
  return { encryptedData: String(d.encryptedData), source: d.source === "password" ? "password" : "passkey", shareGeneration: Number(d.shareGeneration ?? 0), current: true, ...extra };
}
