// Backup of the new copy after a refresh (POST /keys/:id/share-refresh/backup). Each envelope is the same
// stored-share blob the normal backup upload sends. credentialId "slot" = this site's backup slot: the
// server names it (slot:legacy / slot:<rpId>), so the client never guesses the RP. Approved passkeys get a v2
// envelope (escrow-envelope-v2.ts).
import type { KeyFileData } from "../crypto";
import { fetchBackupStatus, type BackupRecipient } from "../escrow-download";
import { sealEnvelopeV2 } from "../escrow-envelope-v2";

export interface EscrowEnvelope { credentialId: string; rpId?: string | null; encryptedData: string }

export const SITE_SLOT = "slot";

/**
 * The envelopes for one sealed blob: the passkey's own (PRF, with its RP) or the backup password's
 * (credentialId "passphrase"), plus the site slot copy.
 */
export function envelopesFor(sealed: string, credentialId: string, rpId: string | undefined): EscrowEnvelope[] {
  const own: EscrowEnvelope = credentialId === "passphrase"
    ? { credentialId, encryptedData: sealed }
    : { credentialId, rpId: rpId ?? null, encryptedData: sealed };
  return [own, { credentialId: SITE_SLOT, encryptedData: sealed }];
}

/** The exact string that is uploaded and hashed into the backup signature. */
export const envelopesJson = (envelopes: EscrowEnvelope[]) => JSON.stringify(envelopes);

/**
 * The refresh carries over passkey approvals: one v2 envelope (sealed to the passkey's escrow key) for each passkey
 * that could restore generation g (`approved`, read BEFORE the refresh). It replaces that passkey's own legacy
 * envelope if there is one; the slot and password copies stay.
 */
export async function withApprovedPasskeys(envelopes: EscrowEnvelope[] | null, approved: BackupRecipient[], keyFile: KeyFileData, target: number): Promise<EscrowEnvelope[] | null> {
  if (approved.length === 0) return envelopes;
  // Each passkey on its own: one that cannot be sealed to (a bad key) is skipped, never the whole backup.
  const v2: EscrowEnvelope[] = [];
  for (const r of approved) {
    try {
      v2.push({ credentialId: r.credentialId, encryptedData: await sealEnvelopeV2({ keyShareId: keyFile.id, credentialId: r.credentialId, generation: target, recipientKey: r.escrowKey, keyFile }) });
    } catch {
      console.warn("[backup] could not seal to one passkey; it is left out of this backup");
    }
  }
  const ids = new Set(v2.map((e) => e.credentialId));
  return [...(envelopes ?? []).filter((e) => !ids.has(e.credentialId)), ...v2];
}

/**
 * Passkeys that can restore the wallet now. Throws (retryable) when the status cannot be read: a backup written
 * without them would silently drop every approval.
 */
export async function approvedRecipients(keyShareId: string): Promise<BackupRecipient[]> {
  const s = await fetchBackupStatus(keyShareId).catch(() => null);
  if (!s) throw Object.assign(new Error("BACKUP_STATUS_UNAVAILABLE"), { code: "BACKUP_STATUS_UNAVAILABLE" });
  return (s.recipients ?? []).filter((r) => r.approved && !!r.escrowKey && r.credentialId !== SITE_SLOT && r.credentialId !== "passphrase");
}
