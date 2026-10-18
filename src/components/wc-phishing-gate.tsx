// Blocking scam-site warning in front of a WalletConnect session proposal or request (iOS: the browser's
// PhishingInterstitial, WCRequestSheet). The default is to reject; continuing needs "Show details" and then
// "I understand the risk", for the proposal and again for every request (as on iOS).

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldBan } from "lucide-react";
import { findPhishingHost } from "../lib/phishing-list";

/** Longest wait for the list before the request is shown anyway (the check fails open, like iOS without a list). */
const CHECK_TIMEOUT_MS = 4000;

interface Props {
  /** dApp URLs to check (metadata url, verified origin). */
  urls: (string | undefined | null)[];
  onReject: () => void;
  children: ReactNode;
}

export function WcPhishingGate({ urls, onReject, children }: Props) {
  const { t } = useTranslation();
  const key = urls.join("|");
  const [result, setResult] = useState<{ key: string; host: string | null } | null>(null);
  const [details, setDetails] = useState(false);
  const [continued, setContinued] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS));
    Promise.race([findPhishingHost(key.split("|")), timeout]).then((host) => {
      if (!cancelled) setResult({ key, host });
    });
    return () => { cancelled = true; };
  }, [key]);

  if (result?.key !== key) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative w-10 h-10 rounded-full border-2 border-white/30 border-t-white animate-spin" aria-label={t("common.loading")} />
      </div>
    );
  }
  const host = result.host;
  if (!host || continued) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="wc-phishing-stop">
      <div className="absolute inset-0 bg-black/60" />
      <div role="alertdialog" aria-labelledby="wc-phishing-title" className="relative bg-surface-secondary border border-red-500/40 rounded-2xl w-full max-w-md shadow-xl p-6 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
          <ShieldBan className="w-7 h-7 text-red-500" aria-hidden />
        </div>
        <h3 id="wc-phishing-title" className="text-base font-semibold text-red-600 dark:text-red-400">{t("wc.phishing.title")}</h3>
        <p className="text-sm font-mono text-text-primary break-all">{host}</p>
        <p className="text-xs text-text-secondary leading-relaxed">{t("wc.phishing.body")}</p>
        <button
          onClick={onReject}
          className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          {t("wc.reject")}
        </button>
        {details ? (
          <div className="space-y-2">
            <p className="text-xs text-text-secondary leading-relaxed">{t("wc.phishing.details")}</p>
            <button
              onClick={() => setContinued(true)}
              className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
            >
              {t("wc.phishing.continue")}
            </button>
          </div>
        ) : (
          <button onClick={() => setDetails(true)} className="text-xs text-text-tertiary hover:text-text-primary">
            {t("wc.phishing.showDetails")}
          </button>
        )}
      </div>
    </div>
  );
}
