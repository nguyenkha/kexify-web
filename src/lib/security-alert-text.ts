// One plain line per security alert kind. Unknown kinds get a generic line, never the raw code.
import type { TFunction } from "i18next";
import { countryName, platformName } from "./device-facts";
import type { SecurityAlert } from "./security-alerts-api";

export const ALERT_KINDS = [
  "login.new", "session.reuse", "sessions.revoked_others", "signer.pending", "signer.cooling_started",
  "signer.cooling_ended", "signer.activated", "signer.revoked", "signer.declined", "passkey.added",
  "passkey.removed", "alert_email.changed",
] as const;

/** i18n key under alerts.kind for an alert kind ("signer.cooling_started" -> "signer_cooling_started"). */
export function alertKindKey(kind: string): string {
  return (ALERT_KINDS as readonly string[]).includes(kind) ? kind.replace(/\./g, "_") : "unknown";
}

export function alertLine(alert: SecurityAlert, t: TFunction, lang: string): string {
  const m = alert.meta ?? {};
  const platform = platformName(m.platform, t);
  const line = t(`alerts.kind.${alertKindKey(alert.kind)}`, {
    platform,
    country: countryName(m.country, lang, t),
    device: m.label || platform,
  });
  return m.walletName ? `${m.walletName}: ${line}` : line;
}
