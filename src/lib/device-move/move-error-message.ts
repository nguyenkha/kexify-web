// User text for a failed device move step (never names keys, copies or refreshes).
import type { TFunction } from "i18next";
import { signerErrorMessage } from "../signer-error-message";
import { PasskeyPendingError } from "../passkey";
import { passkeyErrorMessage } from "../passkey-error-message";

export function moveErrorMessage(err: unknown, t: TFunction): string {
  // WebAuthn: cancelled, timed out, or the browser dropped a prompt not started by a tap.
  const name = (err as { name?: unknown })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return t("move.passkeyCancelled");
  if (err instanceof PasskeyPendingError) return passkeyErrorMessage(err, t);
  const code = String((err as { code?: unknown })?.code ?? "");
  switch (code) {
    case "QR_MISMATCH": return t("move.invalidQr");
    case "TRANSFER_EXPIRED": return t("move.expired");
    case "TRANSFER_CODE_WRONG": return t("move.codeWrong");
    case "TRANSFER_LOGIN_REQUIRED": return t("move.loginRequired");
    case "REFRESH_IN_PROGRESS": case "SESSION_ACTIVE": case "REFRESH_SEALED": return t("move.inProgress");
    case "COOLING_IN_PROGRESS": return t("signers.error.coolingInProgress");
    case "NO_DECLINER": return t("signers.error.noDecliner");
    case "NO_BACKUP": case "PASSWORD_BACKUP_REQUIRED": return t("move.noBackup");
    case "SHARE_GENERATION_MISMATCH": case "TRANSFER_KEY_USED": return t("move.outdated");
    case "account_frozen": return t("move.locked");
    case "RATE_LIMITED": return t("signers.error.rateLimited");
  }
  if (code.startsWith("SIGNER_") || code === "NO_SIGNER") return signerErrorMessage(err, t);
  return t("move.failed");
}
