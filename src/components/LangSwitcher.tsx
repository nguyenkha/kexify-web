import { useState } from "react";
import { setLanguage, getStoredLanguage } from "../i18n/i18n";

const LANGS = [
  { code: "en", label: "EN" },
  { code: "vi", label: "VI" },
] as const;

export function LangSwitcher() {
  const [lang, setLang] = useState(getStoredLanguage);

  function cycle() {
    const idx = LANGS.findIndex((l) => l.code === lang);
    const next = LANGS[(idx + 1) % LANGS.length];
    setLanguage(next.code);
    setLang(next.code);
  }

  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  return (
    <button
      onClick={cycle}
      className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-tertiary transition-colors text-[10px] font-semibold tracking-wide min-w-[28px]"
    >
      {current.label}
    </button>
  );
}
