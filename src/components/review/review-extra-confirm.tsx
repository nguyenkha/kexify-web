// Second, explicit confirm for requests the policy allows per action but that hand over a whole
// collection (setApprovalForAll / PermitForAll): Confirm stays disabled until this is ticked.

import { ShieldAlert } from "lucide-react";
import type { ReviewModel } from "../../lib/review";
import { useReviewText } from "./review-text";

export function ReviewExtraConfirm({ model, checked, onChange }: { model: ReviewModel | null; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useReviewText();
  if (!model?.extraConfirm) return null;
  const collection = model.warnings.find((w) => w.code === "nftApprovalForAll")?.params.collection ?? "";
  return (
    <label className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2.5 cursor-pointer" data-testid="review-extra-confirm">
      <input type="checkbox" className="mt-0.5 accent-red-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-xs leading-relaxed text-red-700 dark:text-red-300">
        <ShieldAlert className="w-3.5 h-3.5 inline-block align-[-2px] mr-1" aria-hidden />
        {t("review.extraConfirm.nftApprovalForAll", { collection })}
      </span>
    </label>
  );
}
