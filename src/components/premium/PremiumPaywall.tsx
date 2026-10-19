// What Premium includes, prices, and the stablecoin way to pay. Premium is iPhone-first; exporting keys stays free.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import { Button } from "../ui";
import type { EntitlementInfo } from "../../lib/premium-api";
import { CryptoPayDialog } from "./CryptoPayDialog";

const FEATURES = ["iphone", "vault", "alerts", "extras"] as const;

export function PremiumPaywall({ info, onClose, onPaid }: { info: EntitlementInfo; onClose: () => void; onPaid: () => void }) {
  const { t } = useTranslation();
  const [paying, setPaying] = useState(false);
  const { monthly, yearly } = info.products;

  useEffect(() => {
    if (paying) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, paying]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div role="dialog" aria-label={t("premium.paywall.title")} className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-sm shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary">{t("premium.paywall.title")}</h3>
          <button onClick={onClose} aria-label={t("common.close")} className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-text-secondary leading-relaxed">{t("premium.paywall.intro")}</p>
          <ul className="space-y-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-xs text-text-secondary">
                <Check className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" />
                {t(`premium.paywall.feature.${f}`)}
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-surface-primary border border-border-primary rounded-lg py-3">
              <p className="text-sm font-semibold text-text-primary">${monthly.priceUsd}</p>
              <p className="text-[11px] text-text-muted">{t("premium.perMonth")}</p>
            </div>
            <div className="bg-surface-primary border border-border-primary rounded-lg py-3">
              <p className="text-sm font-semibold text-text-primary">${yearly.priceUsd}</p>
              <p className="text-[11px] text-text-muted">{t("premium.perYear")}</p>
            </div>
          </div>
          <p className="text-[11px] text-text-muted leading-relaxed">{t("premium.paywall.iphoneFirst")}</p>
          <p className="text-[11px] text-text-muted leading-relaxed">{t("premium.paywall.exportFree")}</p>
          {info.crypto.enabled
            ? <Button fullWidth onClick={() => setPaying(true)}>{t("premium.paywall.payStablecoin")}</Button>
            : <p className="text-xs text-center text-text-muted">{t("premium.paywall.comingSoon")}</p>}
          <p className="text-[11px] text-text-muted text-center">{t("premium.paywall.iphoneBuy")}</p>
        </div>
      </div>
      {paying && <CryptoPayDialog info={info} onClose={() => setPaying(false)} onCredited={onPaid} />}
    </div>
  );
}
