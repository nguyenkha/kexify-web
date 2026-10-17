/**
 * Amounts typed and shown in the user's language without ever misreading them.
 *
 * Canonical form (state, API, signing): ASCII digits with an optional "." ("1234.56"), never grouped.
 * Typed form: whatever the locale writes ("1.234,56" es, "1 234,56" ru, "1,234.56" en, "12,34,567.5" hi).
 *
 * Parsing rule, the same on iOS (KexifyCore LocaleAmount.swift, same test vectors):
 * - "." and "," both present: the last one is the decimal separator, the other groups digits.
 * - one separator used more than once: it groups digits; spaces only ever group.
 * - one separator used once: it is the decimal separator, except when the text also reads as a grouped
 *   integer ("1.234", "12,345"): then it is the decimal only when it is the locale's decimal separator,
 *   otherwise the amount is rejected as ambiguous (the user is asked to write it unambiguously).
 * - grouping must be well formed (1-3 digits then groups of 3, or the Indian 1-2, 2…, 3) with no leading zero.
 * Anything else (letters, signs, exponents, two decimal separators) is invalid.
 */

export type ParsedAmount =
  | { kind: "empty" }
  | { kind: "ok"; value: string }
  | { kind: "invalid" }
  /** "1.234" in a comma-decimal locale: 1.234 or 1234? Never guessed. */
  | { kind: "ambiguous" };

export interface NumberSeparators {
  decimal: string;
  group: string;
}

const separatorCache = new Map<string, NumberSeparators>();

/** The locale's decimal and grouping separators ("es" → "," and "."; "ru" → "," and a no-break space). */
export function separatorsFor(locale: string): NumberSeparators {
  let s = separatorCache.get(locale);
  if (!s) {
    const parts = new Intl.NumberFormat(locale, { numberingSystem: "latn" } as Intl.NumberFormatOptions).formatToParts(1234567.5);
    s = {
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
      group: parts.find((p) => p.type === "group")?.value ?? ",",
    };
    separatorCache.set(locale, s);
  }
  return s;
}

/** Full-width digits and separators (Chinese / Japanese IMEs) to ASCII. */
function toAscii(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 48))
    .replace(/．/g, ".")
    .replace(/，/g, ",");
}

/** "1,234,567" / "12,34,567" split on one grouping character: well formed, no leading zero. */
function validGrouping(groups: string[]): boolean {
  if (groups.length < 2 || groups.some((g) => !/^\d+$/.test(g)) || groups[0].startsWith("0")) return false;
  const last = groups[groups.length - 1];
  const western = groups[0].length <= 3 && groups.slice(1).every((g) => g.length === 3);
  const indian = groups[0].length <= 2 && groups.slice(1, -1).every((g) => g.length === 2) && last.length === 3;
  return western || indian;
}

/** The integer digits of `s` grouped by `group` (or spaces), "" for no digits, null when malformed. */
function integerPart(s: string, group: string | null): string | null {
  if (/^\d*$/.test(s)) return s;
  const used = new Set(s.replace(/\d/g, ""));
  // One grouping character only: "1.234 567" mixes two and is rejected.
  if (used.size !== 1) return null;
  const ch = [...used][0];
  if (ch !== " " && ch !== group) return null;
  const groups = s.split(ch);
  return validGrouping(groups) ? groups.join("") : null;
}

/** Canonical text, or null when there are no digits at all. */
function canonical(int: string, frac: string): string | null {
  if (int === "" && frac === "") return null;
  const i = int.replace(/^0+(?=\d)/, "") || "0";
  return frac ? `${i}.${frac}` : i;
}

/** `s` read with `decimal` (null: integer only) and `group` as the grouping character. */
function read(s: string, decimal: string | null, group: string | null): string | null {
  const at = decimal === null ? s.length : s.indexOf(decimal);
  const frac = decimal === null ? "" : s.slice(at + 1);
  if (!/^\d*$/.test(frac)) return null;
  const int = integerPart(s.slice(0, at), group);
  return int === null ? null : canonical(int, frac);
}

/** What the user typed, read for `locale` (the UI language). See the rule at the top of the file. */
export function parseLocaleAmount(input: string, locale: string): ParsedAmount {
  // Zero-width characters (pasted from web pages) dropped; every whitespace run, NEL included, is one space (same as iOS).
  const s = toAscii(input).replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/[\s\u0085]+/g, " ").trim();
  if (s === "") return { kind: "empty" };
  if (!/^[\d., ]+$/.test(s)) return { kind: "invalid" };

  const result = (v: string | null): ParsedAmount => (v === null ? { kind: "invalid" } : { kind: "ok", value: v });
  const dots = s.split(".").length - 1;
  const commas = s.split(",").length - 1;

  if (dots && commas) {
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    if ((decimal === "." ? dots : commas) !== 1) return { kind: "invalid" };
    return result(read(s, decimal, decimal === "." ? "," : "."));
  }
  const sep = dots ? "." : commas ? "," : null;
  if (sep === null) return result(read(s, null, null));
  if (dots + commas > 1) return result(read(s, null, sep));

  const asDecimal = read(s, sep, null);
  const asGroup = read(s, null, sep);
  if (asDecimal !== null && asGroup !== null) {
    return sep === separatorsFor(locale).decimal ? { kind: "ok", value: asDecimal } : { kind: "ambiguous" };
  }
  return result(asDecimal ?? asGroup);
}

/**
 * A canonical amount ("1234.5"; en-US grouping "1,234.5" is tolerated) in the locale's format ("1.234,5" es),
 * every digit kept: no rounding, no float. Hindi and Thai keep Western digits. Anything else is returned unchanged
 * (addresses, hashes, "< 0.01").
 */
export function formatLocaleAmount(amount: string, locale: string, opts: { grouping?: boolean } = {}): string {
  const m = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return amount;
  const [, sign, intRaw, frac] = m;
  const int = intRaw.replace(/,/g, "");
  const { decimal, group } = separatorsFor(locale);
  let grouped = int;
  if (opts.grouping !== false) {
    // Group the way Intl does for this locale (Indian 2-digit groups for hi), from a BigInt so long integers stay exact.
    // Spanish leaves 4-digit integers ungrouped ("1234,5"); that is the locale's own rule.
    const nf = new Intl.NumberFormat(locale, { numberingSystem: "latn" } as Intl.NumberFormatOptions);
    grouped = nf.formatToParts(BigInt(int)).map((p) => (p.type === "group" ? group : p.value)).join("");
  }
  return sign + grouped + (frac ? decimal + frac : "");
}

/** A canonical amount as the user would type it in this locale: decimal separator only, no grouping ("1234,5"). */
export function editableLocaleAmount(amount: string, locale: string): string {
  return formatLocaleAmount(amount, locale, { grouping: false });
}
