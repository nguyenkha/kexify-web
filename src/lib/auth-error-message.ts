// Localised text for sign-in failures (UX spec sign-in.md "States"). Never raw server English.

import type { TFunction } from "i18next";
import { AuthError } from "./auth";
import { friendlyError } from "./error-message";

export function authErrorMessage(err: unknown, t: TFunction): string {
  if (!(err instanceof AuthError)) return friendlyError(err, t).message;
  switch (err.code) {
    case "network": return t("auth.error.network");
    case "captcha": return t("login.captchaRequired");
    case "rateLimited": return t("auth.error.tooManyAttempts");
    case "invalidCode": return t("auth.error.invalidCode");
    case "codeLocked": return t("auth.error.codeLocked");
    case "tokenInvalid": return t("verifyToken.invalid");
    case "tokenUsed": return t("verifyToken.used");
    case "tokenExpired": return t("verifyToken.expired");
    default: return t("alert.error");
  }
}
