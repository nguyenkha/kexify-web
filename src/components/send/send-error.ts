// Map a send-flow signing failure to what the signing modal shows (UX spec: send.md "States",
// common-states.md "Policy blocked" and "Chain-binding and intent errors").
// Never show raw server English: known failures get a key, unknown ones the generic text with the
// raw message kept for a "Details" disclosure. A cancelled passkey prompt is not an error at all.

import type { TFunction } from "i18next";
import { mapCommonError, stripErrorPrefix } from "../../lib/error-message";

type T = (key: string, opts?: Record<string, unknown>) => string;

export interface SendError {
  /** "cancelled" = the user dismissed the passkey prompt: return to Review silently. */
  kind: "policy" | "error" | "cancelled";
  message: string;
  /** Raw text for the details disclosure (unknown errors only). */
  detail?: string;
  /** Policy leg for the "Blocked by policy" block (null = default reason). */
  policyLeg?: string | null;
}

/** An error whose message is already localised and complete (e.g. too many UTXO inputs). */
export class LocalizedSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalizedSendError";
  }
}

export const POLICY_LEGS = ["approval", "account_control", "value_message", "unknown", "fee"];

/** Localised reason for a policy block; `transfer`, `contract_call` or none use the default. */
export function policyBlockReason(leg: string | null | undefined, t: T): string {
  return leg && POLICY_LEGS.includes(leg) ? t(`send.policyBlockedLeg.${leg}`) : t("send.policyBlockedDefault");
}

interface ErrorFields {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  blockedLeg?: string | null;
  cause?: { name?: string };
}

function rawText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String((err as ErrorFields | null)?.message ?? err);
}

function isPasskeyCancel(e: ErrorFields, raw: string): boolean {
  const name = e.name ?? e.cause?.name;
  return name === "NotAllowedError" || name === "AbortError"
    || /timed out or was not allowed|authentication was not completed|ceremony was (aborted|cancel)/i.test(raw);
}

// Server re-parsed the signed bytes and they do not match the claimed intent (sign-request / tx-verify).
const INTENT_MISMATCH = /does not match|mismatch|\btx: invalid|invalid unsigned tx|expected at most|neither is change|unexpected field|missing \w+tx\b|no verifier/i;

export function mapSendError(err: unknown, t: T): SendError {
  const e = (err ?? {}) as ErrorFields;
  const raw = stripErrorPrefix(rawText(err));

  if (isPasskeyCancel(e, raw)) return { kind: "cancelled", message: "" };
  if (err instanceof LocalizedSendError) return { kind: "error", message: err.message };

  // Policy 403 from /sign/init. lib/mpc localises the leg text; structured fields win when present.
  const leg = typeof e.blockedLeg === "string" ? e.blockedLeg
    : POLICY_LEGS.find((l) => raw === t(`send.policyBlockedLeg.${l}`)) ?? null;
  if (leg || /blocked by policy/i.test(raw)) {
    return { kind: "policy", message: policyBlockReason(leg, t), policyLeg: leg };
  }

  if (e.code === "CHAIN_MISMATCH" || raw === t("send.chainBinding.mismatch")) {
    return { kind: "error", message: t("send.chainBinding.mismatch") };
  }
  if (e.code === "CHAIN_LOOKUP_UNAVAILABLE" || raw === t("send.chainBinding.unavailable")) {
    return { kind: "error", message: t("send.chainBinding.unavailable") };
  }
  if (raw === "passkey_auth_required" || /passkey authentication required/i.test(raw)) {
    return { kind: "error", message: t("send.passkeySessionExpired") };
  }
  // The only passkey is still in probation (lib/passkey PasskeyPendingError; matched by name to keep this module light).
  const pendingAt = e.name === "PasskeyPendingError" ? (err as { passkey?: { activeAt?: string } }).passkey?.activeAt : undefined;
  if (pendingAt) return { kind: "error", message: t("passkey.pendingUntil", { date: new Date(pendingAt).toLocaleString() }) };
  if (raw === "prf_unavailable") return { kind: "error", message: t("send.passkeyNoEncryption") };
  if (/could not decrypt the key share/i.test(raw)) return { kind: "error", message: t("send.couldNotDecryptWrongPasskey") };
  if (/account is disabled/i.test(raw)) return { kind: "error", message: t("activity.blockedDisabledDetail") };

  // Network, 429, account_frozen, 409 busy.
  const common = mapCommonError(err, t as unknown as TFunction);
  if (common) return { kind: "error", message: common };

  if (/session not found|session (expired|timed out)/i.test(raw)) return { kind: "error", message: t("send.sessionTimedOut") };
  if (/DOGE_BELOW_DUST/.test(raw)) return { kind: "error", message: t("send.dogeBelowDust") };
  if (/insufficient (funds|balance|lamports)/i.test(raw)) return { kind: "error", message: t("send.insufficientWithFee") };
  // Only the server's refusal of the signed bytes (transport errors carry a status) is an intent mismatch.
  if (e.status !== undefined && INTENT_MISMATCH.test(raw)) return { kind: "error", message: t("send.intentMismatch"), detail: raw };

  return { kind: "error", message: t("alert.error"), detail: raw || undefined };
}
