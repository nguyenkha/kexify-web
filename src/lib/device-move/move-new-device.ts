// New device side of the QR move: open the transfer, collect and open the share, keep it, then re-key and
// commit (move-share-refresh.ts). The device key is made before the wallet is known and stored once it is.
import { apiUrl } from "../apiBase";
import { authHeaders, getJwtPayload, setToken } from "../auth";
import type { KeyFileData } from "../crypto";
import { clientKeys, freeClientKeyHandles } from "../client-key-cache";
import { deviceSign, getSignerRecord, newKeyRecord, putSignerRecord, setLocalSignerState, type SignerRecord } from "../device-signer-key";
import {
  dropPendingShare, getPendingShare, listPendingShares, openSealedStoredShare, promotePendingShare, savePendingShare, saveSealedStoredShare, sealStoredShare,
} from "../keystore";
import { listSigners } from "../signer-api";
import { wipe } from "../secret-bytes";
import { fromB64, sha256HexOf } from "./move-codec";
import { envelopesFor, type EscrowEnvelope } from "./move-escrow-envelopes";
import { fetchBackupStatus } from "../escrow-download";
import { claimTransfer, openTransfer, type ClaimResult } from "./move-api";
import { encodeMoveQr, moveFingerprint } from "./move-qr-text";
import { transferClaimMessage } from "./move-signer-messages";
import { backupAndCommit, RefreshError, runRefresh, type MoveSigner, type StagedRefresh } from "./move-share-refresh";
import { newEphemeralKeyPair, openFromOldDevice } from "./move-transfer-crypto";

export interface PendingMove {
  transferId: string; nonce: string; expiresAt: string; fingerprint: string; qrText: string;
  device: SignerRecord; eph: { secretKey: Uint8Array; publicKey: Uint8Array };
}

/** How this browser keeps the wallet: the passkey's PRF key, or the backup password. */
export type ShareLock = { prfKey: CryptoKey; credentialId: string; rpId?: string } | { passphrase: string };

export async function startMove(): Promise<PendingMove> {
  const device = await newKeyRecord("pending-move");
  const eph = newEphemeralKeyPair();
  const ephB64 = btoa(String.fromCharCode(...eph.publicKey));
  const t = await openTransfer(device.spki, ephB64);
  const fingerprint = await moveFingerprint(device.spki, ephB64, t.nonce); // computed here, never the server's string
  const qrText = encodeMoveQr({ transferId: t.transferId, nonce: t.nonce, ephPubkey: eph.publicKey, devicePubkey: fromB64(device.spki) });
  return { ...t, fingerprint, qrText, device, eph };
}

export const forgetMove = (m: PendingMove) => wipe(m.eph.secretKey);

/** Collect the move (once). With the code typed from the old device it is released at once. */
export async function claimMove(m: PendingMove, code?: string): Promise<ClaimResult> {
  const sig = await deviceSign(m.device, transferClaimMessage(m.transferId, m.nonce));
  return claimTransfer(m.transferId, sig, code);
}

/** The wallet's public keys as the server knows them (the share must be for exactly this wallet). */
export async function walletPublicKey(keyShareId: string, token?: string): Promise<string | null> {
  const res = await fetch(apiUrl("/api/keys"), { headers: token ? { Authorization: `Bearer ${token}` } : authHeaders() });
  if (!res.ok) return null;
  const keys = ((await res.json()).keys ?? []) as Array<{ id: string; publicKey: string | null }>;
  return keys.find((k) => k.id === keyShareId)?.publicKey ?? null;
}

/** Decrypt the claimed share, check it is this wallet's current copy, and keep the device key under the wallet. */
export async function openClaim(m: PendingMove, claim: ClaimResult): Promise<{ keyFile: KeyFileData; signer: MoveSigner }> {

  const ctx = { keyShareId: claim.keyShareId, transferId: m.transferId, nonce: m.nonce, devicePubkeySha256: await sha256HexOf(fromB64(m.device.spki)) };
  let plain: Uint8Array;
  try {
    plain = await openFromOldDevice(ctx, m.eph.secretKey, claim.ciphertext, claim.senderEphPubkey);
  } finally {
    forgetMove(m);
  }
  let keyFile: KeyFileData;
  try { keyFile = JSON.parse(new TextDecoder().decode(plain)) as KeyFileData; } finally { wipe(plain); }
  const want = await walletPublicKey(claim.keyShareId, claim.session?.token);
  if (keyFile.id !== claim.keyShareId || (keyFile.shareGeneration ?? 0) !== claim.shareGeneration || !want || want.toLowerCase() !== keyFile.publicKey.toLowerCase()) {
    throw new RefreshError("MOVE_DATA_MISMATCH");
  }
  // Pre-login move: the approval is this device's login, kept only once the share checked out.
  if (claim.session?.token) setToken(claim.session.token);
  keyFile.type = getJwtPayload()?.type === "standalone" ? "standalone" : "email";
  const signer: MoveSigner = { ...m.device, keyShareId: claim.keyShareId, signerId: claim.signerId, status: "pending" };
  await putSignerRecord(signer);
  return { keyFile, signer };
}

/** Did the wallet have a server backup before the move? (GET /keys/:id/backup/status, no blob). */
export async function hadBackup(keyShareId: string): Promise<boolean> {
  const s = await fetchBackupStatus(keyShareId);
  return !!s && (s.hasBackup || s.passkeys > 0 || s.password);
}

/** Keep the claimed copy in this browser (so a closed tab can retry), sealed with `lock`. */
export async function keepClaimedShare(keyFile: KeyFileData, lock: ShareLock): Promise<void> {
  const sealed = await sealStoredShare(keyFile.id, keyFile, lock, keyFile.type);
  await saveSealedStoredShare(keyFile.id, sealed, keyFile);
}

async function sealChecked(next: KeyFileData, lock: ShareLock): Promise<string> {
  const sealed = await sealStoredShare(next.id, next, lock, next.type);
  const back = await openSealedStoredShare(sealed, lock);
  if (!back || back.share !== next.share || back.eddsaShare !== next.eddsaShare) throw new RefreshError("BACKUP_CHECK_FAILED");
  return sealed;
}

/**
 * The g+1 backup: a PRF wallet always gets one (its passkey's envelope + the site slot); a password-only wallet
 * only when it had one before. `password` (the backup password the user typed) keeps a password envelope too.
 */
async function sealBackup(next: KeyFileData, lock: ShareLock, backedUp: boolean, password?: string): Promise<{ sealed: string; envelopes: EscrowEnvelope[] | null }> {
  const sealed = await sealChecked(next, lock);
  const envelopes = "prfKey" in lock ? envelopesFor(sealed, lock.credentialId, lock.rpId)
    : backedUp ? envelopesFor(sealed, "passphrase", undefined) : null;
  if (envelopes && password && "prfKey" in lock) {
    envelopes.push({ credentialId: "passphrase", encryptedData: await sealChecked(next, { passphrase: password }) });
  }
  return { sealed, envelopes };
}

/** Commit answers that mean the staged copy is gone: drop it and start over at ecdsa (never commit again). */
const RESTART_CODES = ["REFRESH_EXPIRED", "REFRESH_INCOMPLETE"];

/**
 * Re-key, back up, commit, then make the new copy this browser's. `staged` resumes a failed commit (pass the
 * value from the error's `staged`) instead of refreshing again. The sealed new copy is kept as PENDING before
 * the commit, so a lost answer never loses the only working copy (reconcilePendingShares settles it later).
 */
export async function finishMove(opts: {
  keyFile: KeyFileData; signer: MoveSigner; lock: ShareLock; backedUp: boolean; staged?: StagedRefresh; password?: string;
  /** The user chose to go on without a new server backup. */
  noBackup?: boolean;
  onPhase?: (p: string) => void;
}): Promise<void> {
  const { keyFile, signer, lock } = opts;
  const staged = opts.staged ?? await runRefresh({ keyShareId: keyFile.id, signer, keyFile, generation: keyFile.shareGeneration ?? 0, onPhase: opts.onPhase });
  try {
    opts.onPhase?.("commit");
    const { sealed, envelopes } = await sealBackup(staged.keyFile, lock, opts.backedUp, opts.password);
    savePendingShare({ keyId: keyFile.id, sealed, target: staged.target });
    await backupAndCommit({ keyShareId: keyFile.id, signer, staged, envelopes, noBackup: opts.noBackup });
    await saveSealedStoredShare(keyFile.id, sealed, staged.keyFile);
    dropPendingShare(keyFile.id);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (RESTART_CODES.includes(String((e as { code?: string }).code))) {
      dropPendingShare(keyFile.id);
      dropStaged(staged);
      throw e; // no `staged`: the retry refreshes again from ecdsa
    }
    throw Object.assign(e, { staged });
  }
  clientKeys.set(keyFile.id, staged.handles);
  await setLocalSignerState(keyFile.id, { status: "active" }, signer.spki);
}

/** Drop a staged refresh that will not be committed. */
export function dropStaged(s: StagedRefresh | undefined) { if (s) freeClientKeyHandles(s.handles); }

export type PendingVerdict = "promote" | "drop" | "retry";

/**
 * What to do with a pending copy (same rule as iOS). Wallet at the target AND this browser's signer active =
 * our commit went through: promote. At the target with our signer not active (another device committed), past
 * the target, or still at target - 1 with no refresh in flight: drop. Anything else: retry the commit.
 */
export function pendingVerdict(target: number, walletGeneration: number | undefined, refreshPending: number | null | undefined, mineActive: boolean): PendingVerdict {
  if (walletGeneration === undefined) return "retry";
  if (walletGeneration === target) return mineActive ? "promote" : "drop";
  if (walletGeneration > target) return "drop";
  if (walletGeneration === target - 1 && !refreshPending) return "drop";
  return "retry";
}

/** Settle one pending copy from the server's view; null when the server could not be read (try later). */
export async function settlePendingShare(keyId: string): Promise<PendingVerdict | null> {
  const p = getPendingShare(keyId);
  if (!p) return null;
  const s = await fetchBackupStatus(keyId).catch(() => null);
  if (!s) return null;
  let mineActive = false;
  if (s.walletGeneration === p.target) {
    // Without our own signer id (IndexedDB failed or missing) we cannot tell whose commit it was: try later,
    // never drop what may be the only working copy.
    const rec = await getSignerRecord(keyId).catch(() => null);
    if (!rec?.signerId) return null;
    const rows = await listSigners(keyId).catch(() => null); // also refreshes the local signer state
    if (!rows) return null;
    mineActive = rows.some((r) => r.id === rec.signerId && r.status === "active");
  }
  const v = pendingVerdict(p.target, s.walletGeneration, s.refreshPending, mineActive);
  if (v === "promote") promotePendingShare(keyId);
  if (v === "drop") dropPendingShare(keyId);
  return v;
}

/** App start / page load: settle pending copies whose commit answer was lost. */
export async function reconcilePendingShares(): Promise<void> {
  for (const p of listPendingShares()) {
    try { await settlePendingShare(p.keyId); } catch { /* offline: next start */ }
  }
}
