// Amounts on screen in the UI language ("1.234,5 ETH" in Spanish). Only the digits change: symbols, addresses and
// hashes are never touched, and anything that is not a plain amount is shown as is.

import i18n from "../i18n/i18n";
import { formatLocaleAmount } from "./locale-amount";

/** The UI language for number formatting ("en" before i18n has started). */
export function uiLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language ?? "en";
}

/** "1234.5" / "1,234.5" → the UI language's format. */
export function displayAmount(amount: string): string {
  return formatLocaleAmount(amount, uiLocale());
}

/** "1234.5 ETH" (or "≈ 1234.5 ETH") → the number part in the UI language, the rest unchanged. */
export function displayAmountText(text: string): string {
  const m = /^(≈ |~|-|\+)?(\d[\d,]*(?:\.\d+)?)(\s.*)?$/s.exec(text);
  return m ? `${m[1] ?? ""}${displayAmount(m[2])}${m[3] ?? ""}` : text;
}
