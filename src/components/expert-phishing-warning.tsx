import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

/** Scam warning on the free-form tools (raw message signing, raw broadcast). */
export function ExpertPhishingWarning({ kind }: { kind: "sign" | "broadcast" }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex gap-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-3 py-2.5">
      <TriangleAlert className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-semibold text-yellow-400">{t("expertWarning.title")}</p>
        <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{t(`expertWarning.${kind}`)}</p>
      </div>
    </div>
  );
}
