// Opening the backup a lost-device restore was served: a v2 passkey envelope (escrow key), a legacy PRF stored
// share, a password stored share, or an encrypted key file. No network, so it is unit-tested on its own.
import type { KeyFileData } from "../crypto";
import { decryptKeyFile, isEncryptedKeyFile } from "../crypto";
import { openSealedStoredShare } from "../keystore";
import { ENVELOPE_V2_MODE, openEnvelopeV2 } from "../escrow-envelope-v2";

/**
 * What POST /backup/escrow (or GET /backup) served, plus the PRF key and escrow secret of the same assertion.
 * A v2 envelope also needs the wallet's public key (from the server's wallet list) and the passkey's id.
 */
export interface ServedBackup {
  encryptedData: string; shareGeneration: number; prfKey?: CryptoKey;
  escrowSecret?: Uint8Array; credentialId?: string; publicKey?: string | null;
}

export class BackupOpenError extends Error {
  readonly code = "BACKUP_OPEN_FAILED";
  constructor() { super("BACKUP_OPEN_FAILED"); this.name = "BackupOpenError"; }
}

/** Does this blob need the backup password? (anything but a passkey blob this assertion can open). */
export function blobNeedsPassword(blob: ServedBackup): boolean {
  try {
    const mode = (JSON.parse(blob.encryptedData) as { mode?: string }).mode;
    if (mode === ENVELOPE_V2_MODE) return !blob.escrowSecret;
    return mode !== "prf";
  } catch {
    return true;
  }
}

/** A backup only the backup password opens: a password-sealed stored share, or an encrypted key file. */
export const isPasswordBackup = (v: unknown): boolean =>
  (v as { mode?: unknown })?.mode === "passphrase" || isEncryptedKeyFile(v as KeyFileData);

/** Open a password backup (parsed JSON) of `keyShareId` with `password`. Throws BackupOpenError. */
export async function openPasswordBackup(keyShareId: string, v: unknown, password: string): Promise<KeyFileData> {
  const o = v as Record<string, unknown>;
  let data: KeyFileData | null = null;
  if (o?.mode === "passphrase") data = await openSealedStoredShare(JSON.stringify(o), { passphrase: password });
  else if (isEncryptedKeyFile(o as unknown as KeyFileData)) data = await decryptKeyFile(o as unknown as KeyFileData, password).catch(() => null);
  if (!data || data.id !== keyShareId || !data.share) throw new BackupOpenError();
  return data;
}

/** Decrypt the backup to the wallet's key file (generation from the server). Throws BackupOpenError. */
export async function decryptRestoreBackup(keyShareId: string, blob: ServedBackup, password?: string): Promise<KeyFileData> {
  let v: Record<string, unknown>;
  try { v = JSON.parse(blob.encryptedData) as Record<string, unknown>; } catch { throw new BackupOpenError(); }
  let data: KeyFileData | null = null;
  if (v.mode === ENVELOPE_V2_MODE && blob.escrowSecret && blob.publicKey) {
    data = await openEnvelopeV2(blob.encryptedData, {
      keyShareId, generation: blob.shareGeneration, publicKey: blob.publicKey, escrowSecret: blob.escrowSecret, credentialId: blob.credentialId,
    }).catch(() => null);
  } else if (v.mode === "prf" && blob.prfKey) data = await openSealedStoredShare(blob.encryptedData, { prfKey: blob.prfKey });
  else if (isPasswordBackup(v) && password) data = await openPasswordBackup(keyShareId, v, password).catch(() => null);
  else if (typeof v.share === "string" && !v.encrypted && !v.mode) data = v as unknown as KeyFileData;
  if (!data || data.id !== keyShareId || !data.share) throw new BackupOpenError();
  return { ...data, shareGeneration: blob.shareGeneration };
}
