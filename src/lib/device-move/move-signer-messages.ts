// What the device keys sign during a move and a refresh. Must match api/src/signer-verify.ts byte for byte;
// built from local values only (the QR and this device's own state), never from server text.
import { utf8 } from "./move-codec";

/** Old (active) signer hands its share to the device of the QR. */
export const transferApproveMessage = (keyShareId: string, transferId: string, devicePubkeySha256: string, transferNonce: string, nonce: string) =>
  utf8(`kexify-signer:v1:transfer:${keyShareId}:${transferId}:${devicePubkeySha256}:${transferNonce}:${nonce}`);

/** Old signer's "Not me". */
export const transferRejectMessage = (keyShareId: string, transferId: string, nonce: string) =>
  utf8(`kexify-signer:v1:transfer-reject:${keyShareId}:${transferId}:${nonce}`);

/** New device collects the move (the nonce is the one in its own QR). */
export const transferClaimMessage = (transferId: string, transferNonce: string) =>
  utf8(`kexify-move:v1:claim:${transferId}:${transferNonce}`);

export type RefreshStep = "init-ecdsa" | "init-eddsa" | "backup" | "commit";

/** Each refresh step for target generation `target`; `extra` = sha256 hex of the envelopes JSON for backup. */
export const refreshMessage = (step: RefreshStep, keyShareId: string, target: number, nonce: string, extra = "") =>
  utf8(`kexify-signer:v1:refresh-${step}:${keyShareId}:${target}:${nonce}${extra ? `:${extra}` : ""}`);

/** Active signer downloads the wallet escrow (with a passkey ticket backup.download). */
export const escrowMessage = (keyShareId: string, nonce: string) => utf8(`kexify-signer:v1:escrow:${keyShareId}:${nonce}`);

/** Active signer replaces the wallet backup (POST /keys/:id/backup); blobSha256 = sha256 hex of encryptedData. */
export const backupUploadMessage = (keyShareId: string, blobSha256: string, nonce: string) => utf8(`kexify-signer:v1:backup:${keyShareId}:${blobSha256}:${nonce}`);

/** Active signer lets a passkey restore the wallet (POST /keys/:id/backup/envelopes); blobSha256 = sha256 hex of encryptedData. */
export const envelopeAllowMessage = (keyShareId: string, credentialId: string, generation: number, nonce: string, blobSha256: string) =>
  utf8(`kexify-signer:v1:envelope:${keyShareId}:${credentialId}:${generation}:${nonce}:${blobSha256}`);

/** Active signer unlocks a locked wallet at once (POST /keys/:id/unfreeze); also signed by x1 as the share proof. */
export const unfreezeMessage = (keyShareId: string, nonce: string) => utf8(`kexify-signer:v1:unfreeze:${keyShareId}:${nonce}`);
