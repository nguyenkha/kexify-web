import { describe, expect, test } from "bun:test";
import vectors from "./locale-amount-vectors.json";
import { editableLocaleAmount, formatLocaleAmount, parseLocaleAmount } from "./locale-amount";

const LOCALES = Object.keys(vectors.byLocale);
const outcome = (input: string, locale: string) => {
  const r = parseLocaleAmount(input, locale);
  return r.kind === "ok" ? r.value : r.kind;
};

describe("parseLocaleAmount", () => {
  for (const locale of LOCALES) {
    test(`${locale}: locale-independent vectors`, () => {
      for (const [input, want] of vectors.all) expect([input, outcome(input, locale)]).toEqual([input, want]);
    });
    test(`${locale}: locale vectors`, () => {
      for (const [input, want] of vectors.byLocale[locale as keyof typeof vectors.byLocale]) {
        expect([input, outcome(input, locale)]).toEqual([input, want]);
      }
    });
  }

  test("a formatted amount reads back to the same canonical value in every locale", () => {
    for (const locale of LOCALES) {
      for (const v of ["0.5", "12", "1234.5", "1234567.891", "1000000", "0.000000000000000001", "98765432109876543210.0001"]) {
        expect([locale, outcome(formatLocaleAmount(v, locale), locale)]).toEqual([locale, v]);
        expect([locale, outcome(editableLocaleAmount(v, locale), locale)]).toEqual([locale, v]);
      }
    }
  });
});

describe("formatLocaleAmount", () => {
  for (const [locale, cases] of Object.entries(vectors.format)) {
    test(locale, () => {
      for (const [input, want] of cases) expect(formatLocaleAmount(input, locale)).toBe(want);
    });
  }
  test("leaves non-amounts untouched", () => {
    for (const s of ["0x52908400098527886E0F7030069857D2E4169EE7", "< 0.01", "abc", "1e18", "", "1.2.3"]) {
      expect(formatLocaleAmount(s, "es")).toBe(s);
    }
  });
  test("editable form never groups", () => {
    expect(editableLocaleAmount("1234567.5", "es")).toBe("1234567,5");
    expect(editableLocaleAmount("1234567.5", "en")).toBe("1234567.5");
    expect(editableLocaleAmount("1234567.5", "ru")).toBe("1234567,5");
  });
});
