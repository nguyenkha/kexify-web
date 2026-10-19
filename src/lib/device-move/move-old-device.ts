// Old device side of the QR move: read the transfer the QR names, check the server's keys equal the QR's,
// then on Confirm encrypt this browser's copy of the wallet to the QR's key and approve with the device key.
import type { KeyFileData } from "../crypto";
import { getSignerRecord, deviceSign } from "../device-signer-key";
import { getKeyShareMode, getKeyShareWithPrf } from "../keystore";
import { authenticatePasskey } from "../passkey";
import { requestKeyPassphrase } from "../key-passphrase-prompt";
import { fetchSignerNonce } from "../signer-api";
import { workspaceHeaders } from "../workspace-token";
import { wipe } from "../secret-bytes";
import { sha256HexOf, utf8 } from "./move-codec";
import { approveTransfer, getTransfer, rejectTransfer, MoveApiError, type TransferView } from "./move-api";
import { qrMatchesServer, type MoveQr } from "./move-qr-text";
import { transferApproveMessage, transferRejectMessage } from "./move-signer-messages";
import { sealForNewDevice } from "./move-transfer-crypto";

/** The 6-digit code shown on this device (crypto RNG, no modulo bias). */
export function newMoveCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

/** "482 913". */
export const formatMoveCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** The transfer of a scanned QR, only when the server holds exactly the QR's keys (else MoveApiError QR_MISMATCH). */
export async function loadScannedTransfer(qr: MoveQr): Promise<TransferView> {
  const t = await getTransfer(qr.transferId);
  if (!qrMatchesServer(qr, t)) throw new MoveApiError(0, "QR_MISMATCH");
  return t;
}

/** This browser's copy of the wallet (one passkey tap, or the passphrase prompt). */
async function unlockKeyFile(keyShareId: string): Promise<KeyFileData> {
  const mode = getKeyShareMode(keyShareId);
  if (mode === "passphrase") return requestKeyPassphrase(keyShareId);
  if (mode !== "prf") throw new MoveApiError(0, "NO_SIGNER");
  const { prfKey } = await authenticatePasskey({ withPrf: true });
  const data = prfKey ? await getKeyShareWithPrf(keyShareId, prfKey) : null;
  if (!data) throw new MoveApiError(0, "NO_SIGNER");
  return data;
}

async function signerAuth(keyShareId: string, message: (nonce: string) => Uint8Array) {
  const rec = await getSignerRecord(keyShareId);
  if (!rec?.signerId || rec.status !== "active") throw new MoveApiError(403, "SIGNER_NOT_ACTIVE");
  const nonce = await fetchSignerNonce(keyShareId);
  return { by: rec.signerId, nonce, sig: await deviceSign(rec, message(nonce)) };
}

/** Confirm: hand this browser's copy to the device of the transfer `t` (keys already checked against the QR). */
export async function approveMove(keyShareId: string, t: TransferView, code: string): Promise<{ releaseAt: string }> {
  const fp = await sha256HexOf(Uint8Array.from(atob(t.devicePubkey), (c) => c.charCodeAt(0)));
  const keyFile = await unlockKeyFile(keyShareId);
  const generation = keyFile.shareGeneration ?? 0;
  const plain = utf8(JSON.stringify({
    id: keyFile.id, peer: keyFile.peer, share: keyFile.share, publicKey: keyFile.publicKey,
    eddsaShare: keyFile.eddsaShare, eddsaPublicKey: keyFile.eddsaPublicKey, type: keyFile.type, shareGeneration: generation,
  } satisfies KeyFileData));
  let sealed: { ciphertext: string; senderEphPubkey: string };
  try {
    const eph = Uint8Array.from(atob(t.ephPubkey), (c) => c.charCodeAt(0));
    sealed = await sealForNewDevice({ keyShareId, transferId: t.transferId, nonce: t.nonce, devicePubkeySha256: fp }, eph, plain);
  } finally {
    wipe(plain);
  }
  const auth = await signerAuth(keyShareId, (n) => transferApproveMessage(keyShareId, t.transferId, fp, t.nonce, n));
  const out = await approveTransfer(t.transferId, { keyShareId, ...auth, ...sealed, code, generation }, await workspaceHeaders(keyShareId));
  return { releaseAt: out.releaseAt };
}

/** Not me: stops the move; `frozen` = the account is locked (this login ends too). */
export async function rejectMove(keyShareId: string, transferId: string): Promise<{ frozen: boolean }> {
  const auth = await signerAuth(keyShareId, (n) => transferRejectMessage(keyShareId, transferId, n));
  const out = await rejectTransfer(transferId, { keyShareId, ...auth }, await workspaceHeaders(keyShareId));
  return { frozen: !!out.frozen };
}

