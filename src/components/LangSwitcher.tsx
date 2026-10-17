import { useState } from "react";
import { useTranslation } from "react-i18next";
import { setLanguage, getStoredLanguage } from "../i18n/i18n";
import { LOCALES } from "../i18n/locales";

/** Header language control: shows the current code ("EN", "PT"), opens the full list (native names) on tap. */
export function LangSwitcher() {
  const { t } = useTranslation();
  const [lang, setLang] = useState(getStoredLanguage);

  return (
    <label className="relative p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-tertiary transition-colors text-[10px] font-semibold tracking-wide min-w-[28px] text-center cursor-pointer">
      {lang.split("-")[0].toUpperCase()}
      <select
        value={lang}
        onChange={(e) => { setLanguage(e.target.value); setLang(e.target.value); }}
        aria-label={t("config.language")}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}
