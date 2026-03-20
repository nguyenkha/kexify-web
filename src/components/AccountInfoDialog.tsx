import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { KeyShare } from "../shared/types";


export function AccountInfoDialog({
  keyShare,
  onClose,
}: {
  keyShare: KeyShare;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createdDate = new Date(keyShare.createdAt);
  const formattedDate = createdDate.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const formattedTime = createdDate.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary">{t("accountInfo.title")}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border-secondary">
              <p className="text-[10px] text-text-muted mb-1">{t("accountInfo.name")}</p>
              <p className="text-xs text-text-secondary">{keyShare.name || t("accountInfo.unnamed")}</p>
            </div>
            <div className="px-3 py-2.5 border-b border-border-secondary">
              <p className="text-[10px] text-text-muted mb-1">{t("accountInfo.keyId")}</p>
              <p className="text-xs font-mono text-text-secondary break-all">{keyShare.id}</p>
            </div>
            <div className="px-3 py-2.5 border-b border-border-secondary">
              <p className="text-[10px] text-text-muted mb-1">{t("accountInfo.created")}</p>
              <p className="text-xs text-text-secondary">{formattedDate} at {formattedTime}</p>
            </div>
            <div className="px-3 py-2.5 border-b border-border-secondary flex items-center justify-between">
              <div>
                <p className="text-[10px] text-text-muted mb-1">{t("accountInfo.ecdsaKey")}</p>
                <p className="text-[10px] font-mono text-text-secondary break-all leading-relaxed">
                  {keyShare.publicKey ? keyShare.publicKey : "—"}
                </p>
              </div>
              {keyShare.publicKey ? (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 shrink-0 ml-2">{t("accountInfo.available")}</span>
              ) : (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 shrink-0 ml-2">{t("accountInfo.missing")}</span>
              )}
            </div>
            <div className="px-3 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-text-muted mb-1">{t("accountInfo.eddsaKey")}</p>
                <p className="text-[10px] font-mono text-text-secondary break-all leading-relaxed">
                  {keyShare.eddsaPublicKey}
                </p>
              </div>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 shrink-0 ml-2">{t("accountInfo.available")}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border-secondary">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-xs font-medium bg-surface-tertiary text-text-secondary hover:bg-border-primary transition-colors"
          >
            {t("accountInfo.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
