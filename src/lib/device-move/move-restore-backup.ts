// Opening the backup a lost-device restore was served: a PRF stored share, a password stored share, or an
// encrypted key file. No network, so it is unit-tested on its own.
import type { KeyFileData } from "../crypto";
import { decryptKeyFile, isEncryptedKeyFile } from "../crypto";
import { openSealedStoredShare } from "../keystore";

/** What POST /backup/escrow (or GET /backup) served, plus the PRF key of the same assertion. */
export interface ServedBackup { encryptedData: string; shareGeneration: number; prfKey?: CryptoKey }

export class BackupOpenError extends Error {
  readonly code = "BACKUP_OPEN_FAILED";
  constructor() { super("BACKUP_OPEN_FAILED"); this.name = "BackupOpenError"; }
}

/** Does this blob need the backup password? (anything but a PRF stored share). */
export function blobNeedsPassword(blob: ServedBackup): boolean {
  try {
    return (JSON.parse(blob.encryptedData) as { mode?: string }).mode !== "prf";
  } catch {
    return true;
  }
}

/** Decrypt the backup to the wallet's key file (generation from the server). Throws BackupOpenError. */
export async function decryptRestoreBackup(keyShareId: string, blob: ServedBackup, password?: string): Promise<KeyFileData> {
  let v: Record<string, unknown>;
  try { v = JSON.parse(blob.encryptedData) as Record<string, unknown>; } catch { throw new BackupOpenError(); }
  let data: KeyFileData | null = null;
  if (v.mode === "prf" && blob.prfKey) data = await openSealedStoredShare(blob.encryptedData, { prfKey: blob.prfKey });
  else if (v.mode === "passphrase" && password) data = await openSealedStoredShare(blob.encryptedData, { passphrase: password });
  else if (isEncryptedKeyFile(v as unknown as KeyFileData) && password) data = await decryptKeyFile(v as unknown as KeyFileData, password).catch(() => null);
  else if (typeof v.share === "string" && !v.encrypted && !v.mode) data = v as unknown as KeyFileData;
  if (!data || data.id !== keyShareId || !data.share) throw new BackupOpenError();
  return { ...data, shareGeneration: blob.shareGeneration };
}
