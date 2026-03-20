import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import vi from "./vi.json";

const STORAGE_KEY = "secretkey-lang";

/** Get stored language or detect from browser */
function getInitialLanguage(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  const browserLang = navigator.language.split("-")[0];
  return browserLang === "vi" ? "vi" : "en";
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, vi: { translation: vi } },
  lng: getInitialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

/** Change language and persist to localStorage */
export function setLanguage(lang: string) {
  localStorage.setItem(STORAGE_KEY, lang);
  i18n.changeLanguage(lang);
  document.documentElement.setAttribute("lang", lang);
}

export function getStoredLanguage(): string {
  return i18n.language;
}

export default i18n;
