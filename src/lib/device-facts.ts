// Plain-language facts about a device or login for prompts and alert lines: country, platform, how long ago, wait left.
import type { TFunction } from "i18next";

/** "Vietnam" from "VN" in the UI language; unknown -> "an unknown country". */
export function countryName(code: string | null | undefined, lang: string, t: TFunction): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return t("deviceFacts.unknownCountry");
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** "a web browser" / "an iPhone" / "the command line app" / "a new device". */
export function platformName(platform: string | null | undefined, t: TFunction): string {
  if (platform === "web" || platform === "ios" || platform === "cli") return t(`deviceFacts.platform.${platform}`);
  return t("deviceFacts.platform.unknown");
}

/** Relative time ("5 minutes ago", "in 2 days") in the UI language. */
export function timeAgo(iso: string, lang: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (!Number.isFinite(mins)) return "";
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  return Math.abs(hours) < 24 ? rtf.format(hours, "hour") : rtf.format(Math.round(hours / 24), "day");
}

/** Time left until `iso` as "23 h 59 min" (rounded up to the minute, never negative). */
export function waitLeft(iso: string | null | undefined, t: TFunction, now = Date.now()): string {
  const ms = iso ? new Date(iso).getTime() - now : 0;
  const totalMin = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 60_000) : 0;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? t("deviceFacts.waitHm", { h, m }) : t("deviceFacts.waitM", { m });
}
