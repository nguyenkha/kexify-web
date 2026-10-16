// Warning banners above the hero (UX spec: review-and-sign.md "Warnings"): danger first, one
// banner per warning, the first two shown and the rest behind "+n more warnings".

import { useState } from "react";
import { AlertTriangle, ShieldBan } from "lucide-react";
import type { ReviewWarning } from "../../lib/review";
import { policyBlockReason } from "../send/send-error";
import { useReviewText } from "./review-text";

const VISIBLE = 2;

function texts(w: ReviewWarning, t: (k: string, o?: Record<string, unknown>) => string): { title: string; body: string } {
  switch (w.code) {
    case "policyBlocked":
      return { title: t("send.blockedByPolicy"), body: policyBlockReason(w.params.leg || null, t) };
    case "firstTimeRecipient":
      return { title: t("send.newAddress.title"), body: t("send.newAddress.body") };
    default:
      return { title: t(`review.warn.${w.code}.title`, w.params), body: t(`review.warn.${w.code}.body`, w.params) };
  }
}

export function ReviewWarnings({ warnings, onReviewPolicy }: { warnings: ReviewWarning[]; onReviewPolicy?: () => void }) {
  const { t } = useReviewText();
  const [all, setAll] = useState(false);
  if (warnings.length === 0) return null;
  const shown = all || warnings.length <= VISIBLE + 1 ? warnings : warnings.slice(0, VISIBLE);
  const hidden = warnings.length - shown.length;
  return (
    <div className="space-y-2" data-testid="review-warnings">
      {shown.map((w) => {
        const { title, body } = texts(w, t);
        const danger = w.tone === "danger";
        const Icon = danger ? ShieldBan : AlertTriangle;
        return (
          <div
            key={w.code}
            role={danger ? "alert" : "status"}
            className={`flex gap-2.5 rounded-xl border px-3 py-2.5 ${danger ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}
          >
            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${danger ? "text-red-500 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`} aria-hidden />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${danger ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>{title}</p>
              <p className="text-xs text-text-secondary leading-relaxed mt-0.5">{body}</p>
              {w.code === "policyBlocked" && onReviewPolicy && (
                <button type="button" onClick={onReviewPolicy} className="text-xs font-semibold text-blue-600 dark:text-blue-400 mt-1.5 hover:underline">
                  {t("send.reviewPolicy")} ›
                </button>
              )}
            </div>
          </div>
        );
      })}
      {hidden > 0 && (
        <button type="button" onClick={() => setAll(true)} className="w-full text-xs font-medium text-text-tertiary hover:text-text-primary py-1">
          {t("review.moreWarnings", { count: hidden })}
        </button>
      )}
    </div>
  );
}
