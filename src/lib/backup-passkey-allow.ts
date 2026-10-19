// "Allow passkey to restore this wallet" (phase 4b): the ACTIVE signing device seals the wallet to a passkey's
// escrow key (envelope v2) and uploads it with its device key. The passkey this tab just asserted is allowed
// silently; any other one only after the visible prompt (components/backup/allow-passkey-prompt.tsx).
import { apiUrl } from "./apiBase";
import { authHeaders, getToken, isStandaloneJwt } from "./auth";
import { isRecoveryMode } from "./recovery";
import type { KeyFileData } from "./crypto";
import { deviceSign, getSignerRecord } from "./device-signer-key";
import { fetchBackupStatus, type BackupRecipient } from "./escrow-download";
import { sealEnvelopeV2 } from "./escrow-envelope-v2";
import { ownEscrowKeyMatches, passkeyAssertedHere } from "./passkey-escrow-key";
import { fetchSignerNonce } from "./signer-api";
import { workspaceHeaders } from "./workspace-token";
import { sha256HexOf, utf8 } from "./device-move/move-codec";
import { envelopeAllowMessage } from "./device-move/move-signer-messages";

/** Fired after something changed which passkeys can restore (a move committed, a passkey was added). */
export const BACKUP_RECIPIENTS_EVENT = "kx-backup-recipients";

export class AllowPasskeyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.name = "AllowPasskeyError"; this.status = status; this.code = code; }
}

/** Passkeys not yet allowed for `keyShareId`, with the wallet's current generation; null when not readable. */
export async function pendingRecipients(keyShareId: string): Promise<{ generation: number; pending: BackupRecipient[] } | null> {
  const s = await fetchBackupStatus(keyShareId).catch(() => null);
  if (!s) return null;
  const generation = s.walletGeneration ?? s.shareGeneration ?? 0;
  return { generation, pending: (s.recipients ?? []).filter((r) => !r.approved && !!r.escrowKey) };
}

/** POST /keys/:id/backup/envelopes for one passkey. `keyFile` must be this wallet's copy at `generation`. */
export async function allowPasskeyRestore(keyShareId: string, recipient: BackupRecipient, keyFile: KeyFileData, generation: number): Promise<void> {
  if ((keyFile.shareGeneration ?? 0) !== generation) throw new AllowPasskeyError(409, "SHARE_GENERATION_MISMATCH");
  const rec = await getSignerRecord(keyShareId).catch(() => null);
  if (!rec?.signerId || rec.status !== "active") throw new AllowPasskeyError(403, "SIGNER_NOT_ACTIVE");
  const encryptedData = await sealEnvelopeV2({ keyShareId, credentialId: recipient.credentialId, generation, recipientKey: recipient.escrowKey, keyFile });
  const nonce = await fetchSignerNonce(keyShareId);
  const sig = await deviceSign(rec, envelopeAllowMessage(keyShareId, recipient.credentialId, generation, nonce, await sha256HexOf(utf8(encryptedData))));
  const res = await fetch(apiUrl(`/api/keys/${encodeURIComponent(keyShareId)}/backup/envelopes`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await workspaceHeaders(keyShareId)) },
    body: JSON.stringify({ credentialId: recipient.credentialId, shareGeneration: generation, encryptedData, signerId: rec.signerId, nonce, sig }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AllowPasskeyError(res.status, String(data?.code ?? data?.error ?? res.status));
}

/**
 * The pending passkeys that may be allowed WITHOUT asking: asserted by this tab, and the server's escrow key equals
 * the one derived here. A mismatch is logged and dropped (never wrapped to, never prompted: the prompt also skips
 * every passkey asserted here).
 */
export function silentRecipients(pending: BackupRecipient[]): BackupRecipient[] {
  return pending.filter((r) => {
    if (!passkeyAssertedHere(r.credentialId)) return false;
    if (ownEscrowKeyMatches(r.credentialId, r.escrowKey)) return true;
    console.warn("[backup] escrow key on the server differs from this passkey's: not allowing it");
    return false;
  });
}

/**
 * Allow, without asking, every not-yet-allowed passkey this tab itself asserted (it proved it has that passkey).
 * Best effort: a refusal leaves it for the next time. Returns how many were allowed.
 */
export async function allowOwnPasskeysSilently(keyShareId: string, keyFile: KeyFileData): Promise<number> {
  if (keyFile.type === "standalone" || isStandaloneJwt()) return 0; // anonymous: password backups only
  const p = await pendingRecipients(keyShareId);
  if (!p) return 0;
  let n = 0;
  for (const r of silentRecipients(p.pending)) {
    try { await allowPasskeyRestore(keyShareId, r, keyFile, p.generation); n++; } catch { /* asked again next open */ }
  }
  return n;
}

export interface AllowRequest { keyShareId: string; walletName: string | null; generation: number; recipient: BackupRecipient }

/** Passkeys waiting to be allowed on wallets where this browser is the active signer. */
export async function findAllowRequests(): Promise<AllowRequest[]> {
  // Anonymous wallets restore with the backup password only: never ask to allow a passkey there.
  if (isRecoveryMode() || !getToken() || isStandaloneJwt()) return [];
  const res = await fetch(apiUrl("/api/keys"), { headers: authHeaders() }).catch(() => null);
  if (!res?.ok) return [];
  const keys = ((await res.json().catch(() => ({}))).keys ?? []) as Array<{ id: string; name: string | null; enabled?: boolean }>;
  const found = await Promise.all(keys.filter((k) => k.enabled !== false).map(async (k) => {
    const rec = await getSignerRecord(k.id).catch(() => null);
    if (!rec?.signerId || rec.status !== "active") return [];
    const p = await pendingRecipients(k.id);
    return (p?.pending ?? []).map((recipient) => ({ keyShareId: k.id, walletName: k.name, generation: p!.generation, recipient }));
  }));
  return found.flat();
}

/**
 * After a PRF unlock of the browser copy (a sign tap) on the ACTIVE signer: allow the passkey(s) this tab asserted
 * that still cannot restore, under the same guard (key derived here == server key). Background, best effort; the copy
 * is decrypted again only when there is something to allow.
 */
export async function allowOwnPasskeyAfterUnlock(keyShareId: string, keyId: string, prfKey: CryptoKey): Promise<void> {
  try {
    if (isStandaloneJwt() || isRecoveryMode()) return;
    const rec = await getSignerRecord(keyShareId).catch(() => null);
    if (!rec?.signerId || rec.status !== "active") return;
    const p = await pendingRecipients(keyShareId);
    if (!p || silentRecipients(p.pending).length === 0) return;
    const { getKeyShareWithPrf } = await import("./keystore"); // lazy: keystore touches the DOM at load
    const keyFile = await getKeyShareWithPrf(keyId, prfKey);
    if (keyFile) await allowOwnPasskeysSilently(keyShareId, keyFile);
  } catch { /* next unlock */ }
}
