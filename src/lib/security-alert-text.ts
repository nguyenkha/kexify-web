// One plain line per security alert kind. Unknown kinds get a generic line, never the raw code.
import type { TFunction } from "i18next";
import { countryName, platformName } from "./device-facts";
import type { SecurityAlert } from "./security-alerts-api";

export const ALERT_KINDS = [
  "login.new", "session.reuse", "sessions.revoked_others", "signer.pending", "signer.cooling_started",
  "signer.cooling_ended", "signer.activated", "signer.revoked", "signer.declined", "passkey.added",
  "passkey.removed", "alert_email.changed", "move.stopped", "share.refreshed", "escrow.downloaded", "backup.dropped",
  "backup.passkey_allowed", "wallet.locked", "wallet.unlock_scheduled", "wallet.unlocked",
] as const;

/** i18n key under alerts.kind for an alert kind ("signer.cooling_started" -> "signer_cooling_started"). */
export function alertKindKey(kind: string): string {
  return (ALERT_KINDS as readonly string[]).includes(kind) ? kind.replace(/\./g, "_") : "unknown";
}

export function alertLine(alert: SecurityAlert, t: TFunction, lang: string): string {
  const m = alert.meta ?? {};
  const platform = platformName(m.platform, t);
  const passkeyLine = alert.kind === "backup.passkey_allowed";
  const line = t(`alerts.kind.${alertKindKey(alert.kind)}`, {
    platform,
    country: countryName(m.country, lang, t),
    device: m.label || platform,
    ...(passkeyLine ? { passkey: m.passkeyName || t("backup.allowPasskey.unnamed"), wallet: m.walletName || "" } : {}),
  });
  // A line that names the wallet itself gets no "wallet: " prefix.
  return m.walletName && !passkeyLine ? `${m.walletName}: ${line}` : line;
}
