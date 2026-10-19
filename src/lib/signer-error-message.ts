import type { TFunction } from "i18next";
import { PasskeyPendingError } from "./passkey";
import { passkeyErrorMessage } from "./passkey-error-message";
import { SignerApiError } from "./signer-api";

/** User-facing text for a signer action failure. Never shows raw server codes or fetch errors. */
export function signerErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof PasskeyPendingError) return passkeyErrorMessage(err, t);
  if (err instanceof SignerApiError) {
    if (err.code === "NO_SIGNER") return t("signers.unlockFirst"); // share still locked: no key to register with
    if (err.code === "LAST_SIGNER_NO_BACKUP") return t("signers.removeLast.noBackup");
    if (err.code === "COOLING_IN_PROGRESS") return t("signers.error.coolingInProgress");
    if (err.code === "account_frozen") return t("signers.error.frozen");
    if (err.code === "MOVE_PENDING") return t("signers.error.movePending");
    if (err.code === "RATE_LIMITED" || err.status === 429) return t("signers.error.rateLimited");
    if (err.code.startsWith("SIGNER_") && err.status === 403) return t("signers.error.notSigner");
  }
  return t("signers.actionFailed");
}
