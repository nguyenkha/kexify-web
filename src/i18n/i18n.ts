import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import vi from "./vi.json";
import zhHans from "./zh-Hans.json";
import es from "./es.json";
import ptBR from "./pt-BR.json";
import id from "./id.json";
import th from "./th.json";
import ko from "./ko.json";
import ja from "./ja.json";
import hi from "./hi.json";
import ru from "./ru.json";
import { matchLocale, type LocaleCode } from "./locales";

const STORAGE_KEY = "secretkey-lang";

const RESOURCES: Record<LocaleCode, object> = {
  en, vi, "zh-Hans": zhHans, es, "pt-BR": ptBR, id, th, ko, ja, hi, ru,
};

/** The language picked in Settings, else the first browser language we offer, else English. */
function getInitialLanguage(): LocaleCode {
  let stored: string | null = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* storage blocked */ }
  const picked = matchLocale(stored);
  if (picked) return picked;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return "en";
}

const initial = getInitialLanguage();
i18n.use(initReactI18next).init({
  resources: Object.fromEntries(Object.entries(RESOURCES).map(([code, translation]) => [code, { translation }])),
  lng: initial,
  // Any key missing in a language shows the English text, never the raw key.
  fallbackLng: "en",
  supportedLngs: Object.keys(RESOURCES),
  // "zh-Hans" / "pt-BR" are whole codes here, not a language plus a region to fall back from.
  load: "currentOnly",
  interpolation: { escapeValue: false },
});
document.documentElement.setAttribute("lang", initial);

/** Change language and persist to localStorage */
export function setLanguage(lang: string) {
  const code = matchLocale(lang) ?? "en";
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage blocked */ }
  i18n.changeLanguage(code);
  document.documentElement.setAttribute("lang", code);
}

export function getStoredLanguage(): string {
  return i18n.language;
}

export default i18n;
