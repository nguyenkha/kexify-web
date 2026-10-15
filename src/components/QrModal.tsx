import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Chain, Asset } from "../lib/api";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Info, Share2, Smartphone } from "lucide-react";
import { CopyableText } from "./ui";

/** Chains whose exchange deposits usually ask for a memo / tag; our own address needs none. */
const MEMO_CHAINS = new Set(["xrp", "xlm", "ton"]);

/** Receive view (UX spec: receive.md): network label, QR, full tap-to-copy address, network warning. */
export function QrModal({ address, asset, chain, onClose }: { address: string; asset: Asset; chain: Chain; onClose: () => void }) {
  const { t } = useTranslation();
  const network = chain.displayName;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function share() {
    // User cancelling the share sheet rejects; nothing to report.
    navigator.share({ text: address }).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-sm shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5"><Smartphone className="w-4 h-4" />{t("common.qrReceive")}</h3>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
            {chain.iconUrl && <img src={chain.iconUrl} alt="" className="w-4 h-4 rounded-full" />}
            <span>{asset.isNative ? network : `${asset.symbol} · ${network}`}</span>
          </div>
          <div className="bg-white rounded-xl p-4 relative">
            <QRCodeSVG value={address} size={200} level="M" />
            {(asset.iconUrl || chain.iconUrl) && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="bg-white rounded-full p-1">
                  <img
                    src={asset.iconUrl || chain.iconUrl!}
                    alt={asset.symbol}
                    className="w-8 h-8 rounded-full"
                  />
                </div>
              </div>
            )}
          </div>
          <CopyableText
            value={address}
            className="w-full items-center text-text-secondary"
            textClassName="font-mono text-xs break-all text-center leading-relaxed"
          />
          {canShare && (
            <button
              onClick={share}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              {t("receive.share")}
            </button>
          )}
          <div className="w-full flex items-start gap-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-yellow-500">{t("receive.warning.title")}</p>
              <p className="text-[11px] text-yellow-500/80 leading-relaxed mt-0.5">{t("receive.warning.body", { network })}</p>
            </div>
          </div>
          {MEMO_CHAINS.has(chain.type) && (
            <div className="w-full flex items-start gap-2.5 bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5">
              <Info className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-text-secondary">{t("receive.memo.title")}</p>
                <p className="text-[11px] text-text-muted leading-relaxed mt-0.5">{t("receive.memo.body")}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
