/** UI languages: code (i18next + <html lang>), the name in its own language for the picker. */
export const LOCALES = [
  { code: "en", name: "English" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "zh-Hans", name: "简体中文" },
  { code: "es", name: "Español" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "th", name: "ไทย" },
  { code: "ko", name: "한국어" },
  { code: "ja", name: "日本語" },
  { code: "hi", name: "हिन्दी" },
  { code: "ru", name: "Русский" },
] as const;

export type LocaleCode = (typeof LOCALES)[number]["code"];

const CODES: readonly string[] = LOCALES.map((l) => l.code);

/** Best supported locale for a BCP 47 tag ("pt-PT" → "pt-BR", "zh-CN" → "zh-Hans"), else null. */
export function matchLocale(tag: string | null | undefined): LocaleCode | null {
  if (!tag) return null;
  if (CODES.includes(tag)) return tag as LocaleCode;
  const lower = tag.toLowerCase();
  // Traditional Chinese is not offered: Simplified would be wrong for zh-TW / zh-HK / zh-Hant readers.
  if (lower.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(lower) ? null : "zh-Hans";
  if (lower.startsWith("pt")) return "pt-BR";
  const base = lower.split("-")[0];
  return (CODES.includes(base) ? base : null) as LocaleCode | null;
}
