// Map errors to localised, user-facing text (UX spec: common-states.md "Errors").
// Never show raw server English, browser exception text or an "Error: " prefix. Unknown errors
// get a generic message; the raw text is kept as `detail` for a support disclosure.

import type { TFunction } from "i18next";

export interface FriendlyError {
  message: string;
  /** Raw text for a "details" disclosure; absent when the message already says it all. */
  detail?: string;
}

function rawText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Raw error text without "Error: " prefixes, for logs and the details disclosure. */
export function stripErrorPrefix(text: string): string {
  return text.replace(/^(\w*Error:\s*)+/i, "").trim();
}

/** Known server / browser failures shared by every flow. Returns null when not recognised. */
export function mapCommonError(err: unknown, t: TFunction): string | null {
  const text = rawText(err);
  if (/failed to fetch|networkerror|network error|load failed|server unreachable/i.test(text)) {
    return t("auth.error.network");
  }
  if (/\b429\b|too many requests|rate limit/i.test(text)) return t("common.rateLimited");
  if (/account_frozen|account is frozen/i.test(text)) return t("freeze.blockedReason");
  if (/another operation is (already )?in progress|\b409\b.*in progress/i.test(text)) return t("send.busy");
  return null;
}

/** Mapped message, or the generic fallback with the raw text as detail. */
export function friendlyError(err: unknown, t: TFunction): FriendlyError {
  const mapped = mapCommonError(err, t);
  if (mapped) return { message: mapped };
  const detail = stripErrorPrefix(rawText(err));
  return { message: t("alert.error"), detail: detail || undefined };
}
