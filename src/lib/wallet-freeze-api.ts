// Lock / unlock of a wallet WITHOUT an account (phase 4b, standalone session). Account wallets keep the account
// freeze (FrozenBanner). Unlock from the signing device is at once (device key + share proof by x1, the same proof
// as the refresh commit); with a passkey it waits 72 h (the server sets unfreezeAt, check-on-read on the server).
import { apiUrl } from "./apiBase";
import { clientKeys } from "./client-key-cache";
import { deviceSign, getSignerRecord } from "./device-signer-key";
import { authenticatePasskey, sensitiveHeadersFor } from "./passkey";
import { fetchSignerNonce } from "./signer-api";
import { clientScalar, clientScalarFromHandle, shareProofHex } from "./unfreeze-share-proof";
import { unfreezeMessage } from "./device-move/move-signer-messages";
import { unlockKeyFile } from "./device-move/move-old-device";

export class WalletLockError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) { super(code); this.name = "WalletLockError"; this.status = status; this.code = code; }
}

async function call<T>(keyShareId: string, path: "freeze" | "unfreeze", method: "POST" | "DELETE", body?: unknown, ticket?: string): Promise<T> {
  const res = await fetch(apiUrl(`/api/keys/${encodeURIComponent(keyShareId)}/${path}`), {
    method,
    headers: await sensitiveHeadersFor(keyShareId, ticket),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new WalletLockError(res.status, String(data?.code ?? data?.error ?? res.status));
  return data as T;
}

/** "Lock this wallet": nobody can sign until it is unlocked. */
export const lockWallet = (keyShareId: string) => call<{ ok: boolean }>(keyShareId, "freeze", "POST");

/** Is this browser the wallet's active signing device? (then it can unlock at once). */
export async function isActiveSigner(keyShareId: string): Promise<boolean> {
  const rec = await getSignerRecord(keyShareId).catch(() => null);
  return !!rec?.signerId && rec.status === "active";
}

/** x1 of this browser's copy: from the in-memory handle when there is one, else unlock the copy (tap / password). */
async function clientX1(keyShareId: string): Promise<Uint8Array> {
  const cached = clientKeys.get(keyShareId);
  if (cached?.ecdsa) return clientScalarFromHandle(cached.mpc, cached.ecdsa);
  return clientScalar((await unlockKeyFile(keyShareId)).share);
}

/** Signing device: unlock now (device signature + share proof over the same message). */
export async function unlockWalletFromSigner(keyShareId: string): Promise<void> {
  const rec = await getSignerRecord(keyShareId);
  if (!rec?.signerId || rec.status !== "active") throw new WalletLockError(403, "SIGNER_NOT_ACTIVE");
  const x1 = await clientX1(keyShareId);
  let shareProof: string;
  let nonce: string;
  let msg: Uint8Array;
  try {
    nonce = await fetchSignerNonce(keyShareId);
    msg = unfreezeMessage(keyShareId, nonce);
    shareProof = shareProofHex(msg, x1);
  } finally {
    x1.fill(0);
  }
  const sig = await deviceSign(rec, msg);
  await call(keyShareId, "unfreeze", "POST", { signerId: rec.signerId, nonce, sig, shareProof });
}

/** Any other device: a wallet-scoped passkey schedules the unlock (72 h). Returns when it unlocks. */
export async function unlockWalletWithPasskey(keyShareId: string): Promise<string | null> {
  const { token } = await authenticatePasskey({ action: { action: "unfreeze", keyShareId } });
  const out = await call<{ unfreezeAt?: string }>(keyShareId, "unfreeze", "POST", undefined, token);
  return out.unfreezeAt ?? null;
}

/** Stop a scheduled passkey unlock. */
export const cancelWalletUnlock = (keyShareId: string) => call<{ ok: boolean }>(keyShareId, "unfreeze", "DELETE");
