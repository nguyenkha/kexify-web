// Finish a move whose commit answer was lost and that app-start reconcile could not settle (neither clearly
// committed nor clearly dropped): open the pending copy (one passkey tap, or the backup password) and retry the
// commit with it. The server answers ALREADY_COMMITTED / already:true when it went through after all.
import { clientKeys, freeClientKeyHandles, type ClientKeyHandles } from "../client-key-cache";
import { getSignerRecord, setLocalSignerState } from "../device-signer-key";
import { dropPendingShare, getPendingShare, openSealedStoredShare, promotePendingShare } from "../keystore";
import { getMpcInstance } from "../mpc";
import { sharePartsFromString, wipe } from "../secret-bytes";
import { approvedRecipients, envelopesFor, withApprovedPasskeys } from "./move-escrow-envelopes";
import { settlePendingShare, type ShareLock } from "./move-new-device";
import { backupAndCommit, RefreshError, type MoveSigner } from "./move-share-refresh";

/** Answers after which the pending copy can never be committed: drop it (the old copy keeps working). */
const DEAD_CODES = ["REFRESH_EXPIRED", "REFRESH_INCOMPLETE", "SIGNER_NOT_ACTIVE", "SIGNER_REVOKED", "SHARE_GENERATION_MISMATCH"];

/** Does the pending copy of `keyId` open with the passkey (PRF) or only with the backup password? */
export function pendingNeedsPassword(keyId: string): boolean {
  try { return (JSON.parse(getPendingShare(keyId)?.sealed ?? "{}") as { mode?: string }).mode !== "prf"; } catch { return true; }
}

export async function retryPendingCommit(keyId: string, lock: ShareLock, opts: { noBackup?: boolean } = {}): Promise<void> {
  // The server may have settled it meanwhile (our commit went through, or another device moved on).
  const verdict = await settlePendingShare(keyId);
  if (verdict === "promote" || verdict === "drop") return;
  const p = getPendingShare(keyId);
  if (!p) return;
  const keyFile = await openSealedStoredShare(p.sealed, lock);
  if (!keyFile || keyFile.id !== keyId) throw new RefreshError("BACKUP_OPEN_FAILED");
  const rec = await getSignerRecord(keyId);
  if (!rec?.signerId) throw new RefreshError("NO_SIGNER");
  const mpc = await getMpcInstance();
  const handles: ClientKeyHandles = { mpc };
  try {
    const ep = sharePartsFromString(keyFile.share);
    try { handles.ecdsa = mpc.deserializeEcdsa2p(ep); } finally { wipe(ep); }
    if (keyFile.eddsaShare) {
      const dp = sharePartsFromString(keyFile.eddsaShare);
      try { handles.eddsa = mpc.deserializeEcKey2p(dp); } finally { wipe(dp); }
    }
    const base = "prfKey" in lock ? envelopesFor(p.sealed, lock.credentialId, lock.rpId) : envelopesFor(p.sealed, "passphrase", undefined);
    const envelopes = await withApprovedPasskeys(base, await approvedRecipients(keyId), keyFile, p.target);
    await backupAndCommit({ keyShareId: keyId, signer: rec as MoveSigner, staged: { keyFile, handles, target: p.target }, envelopes, noBackup: opts.noBackup });
  } catch (err) {
    freeClientKeyHandles(handles);
    if (DEAD_CODES.includes(String((err as { code?: string }).code))) dropPendingShare(keyId);
    throw err;
  }
  promotePendingShare(keyId);
  clientKeys.set(keyId, handles);
  await setLocalSignerState(keyId, { status: "active" }, rec.spki);
}
