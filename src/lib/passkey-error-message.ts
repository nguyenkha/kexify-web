import type { TFunction } from "i18next";
import { PasskeyPendingError } from "./passkey";

/** User-facing text for a passkey error; a passkey in probation gets its own message. */
export function passkeyErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof PasskeyPendingError) {
    return t("passkey.pendingUntil", { date: new Date(err.passkey.activeAt).toLocaleString() });
  }
  return String(err);
}
