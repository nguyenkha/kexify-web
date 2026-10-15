// "Blocked by policy" block (UX spec: common-states.md "Policy blocked"). Shared by the Review
// pre-check and the signing modal. The reason is always a localised key, never server English.

import { useTranslation } from "react-i18next";
import { ShieldBan } from "lucide-react";

export function PolicyBlockedNotice({
  reason,
  nothingSent,
  onReviewPolicy,
}: {
  reason: string;
  nothingSent?: boolean;
  /** Opens the wallet's policy rules; the link is hidden when not given. */
  onReviewPolicy?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-left">
      <p className="text-xs font-medium text-red-400 flex items-center gap-1.5">
        <ShieldBan className="w-3.5 h-3.5 shrink-0" />
        {t("send.blockedByPolicy")}
      </p>
      <p className="text-[11px] text-red-400/80 mt-1 leading-relaxed">{reason}</p>
      {nothingSent && <p className="text-[11px] text-text-muted mt-1">{t("send.nothingSent")}</p>}
      {onReviewPolicy && (
        <button
          type="button"
          onClick={onReviewPolicy}
          className="mt-2 text-[11px] font-medium text-blue-400 hover:text-blue-300 underline"
        >
          {t("send.reviewPolicy")}
        </button>
      )}
    </div>
  );
}
