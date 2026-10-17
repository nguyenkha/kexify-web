// Render a review-model Label with react-i18next. A `count` param is passed as a number so
// i18next picks the plural form (`review.actions_one` / `_other`).

import { useTranslation } from "react-i18next";
import { displayAmountText } from "../../lib/display-amount";
import { formatUsd } from "../../lib/prices";
import type { Label } from "../../lib/review";

export function useReviewText() {
  const { t, i18n } = useTranslation();
  const text = (l: Label | undefined): string => {
    if (!l) return "";
    // Builder-made amounts in the user's number format; any other literal (a dApp's text) exactly as received.
    if ("text" in l) return l.amount ? displayAmountText(l.text) : l.text;
    const params: Record<string, unknown> = { ...l.params };
    if (l.params?.count != null) params.count = Number(l.params.count);
    return t(l.key, params);
  };
  const usd = (n: number | undefined) => (n == null ? "" : formatUsd(n));
  const date = (epochSec: number) => new Date(epochSec * 1000).toLocaleString(i18n.language);
  return { t, text, usd, date };
}
