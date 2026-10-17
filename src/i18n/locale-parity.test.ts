import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALES, matchLocale } from "./locales";

type Tree = { [k: string]: string | Tree };
const load = (code: string): Tree => JSON.parse(readFileSync(join(import.meta.dir, `${code}.json`), "utf8"));

function flatten(obj: Tree, prefix = "", out: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "object") flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

const vars = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join();
const en = flatten(load("en"));

describe("locale files", () => {
  for (const { code } of LOCALES.filter((l) => l.code !== "en")) {
    test(`${code}: same keys and {{placeholders}} as en, nothing empty`, () => {
      const t = flatten(load(code));
      // Extra keys only for the language's own plural forms (ru `_few` / `_many` next to an en `_other`).
      const extra = Object.keys(t).filter((k) => !(k in en));
      const pluralForm = (k: string) => /_(zero|one|two|few|many)$/.test(k) && `${k.replace(/_[a-z]+$/, "")}_other` in en;
      expect(extra.filter((k) => !pluralForm(k))).toEqual([]);
      expect(Object.keys(en).filter((k) => !(k in t))).toEqual([]);
      const enText = (k: string) => en[k] ?? en[`${k.replace(/_[a-z]+$/, "")}_other`];
      const bad = Object.keys(t).filter((k) => !t[k]?.trim() || vars(t[k]) !== vars(enText(k)));
      expect(bad).toEqual([]);
    });
  }
});

describe("plural forms", () => {
  test("every language has each CLDR plural form it needs for every en plural key", () => {
    const missing: string[] = [];
    for (const { code } of LOCALES) {
      const t = flatten(load(code));
      const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
      for (const k of Object.keys(en).filter((k) => k.endsWith("_other"))) {
        for (const c of cats) if (!t[k.replace(/_other$/, `_${c}`)]) missing.push(`${code}: ${k.replace(/_other$/, `_${c}`)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("matchLocale", () => {
  test("maps system tags to offered locales", () => {
    expect(matchLocale("pt-PT")).toBe("pt-BR");
    expect(matchLocale("zh-CN")).toBe("zh-Hans");
    expect(matchLocale("zh-Hans-SG")).toBe("zh-Hans");
    expect(matchLocale("zh-TW")).toBeNull();
    expect(matchLocale("es-MX")).toBe("es");
    expect(matchLocale("ru-RU")).toBe("ru");
    expect(matchLocale("fr-FR")).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});
