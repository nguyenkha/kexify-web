// Pay for Premium with a stablecoin: pick term + network, send the exact amount, then paste the tx hash.
// Prepaid, no auto-renew.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QRCodeSVG } from "qrcode.react";
import { X } from "lucide-react";
import { Button, CopyableText, ErrorBox, Spinner } from "../ui";
import { createCryptoIntent, getCryptoOptions, type CryptoIntent, type CryptoOptions, type EntitlementInfo, type PremiumProduct } from "../../lib/premium-api";
import { CryptoClaimForm } from "./CryptoClaimForm";
import { payErrorKey } from "./pay-error-key";

export const CHAIN_NAME = { base: "Base", solana: "Solana", tron: "TRON" } as const;
const FIELD = "w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-blue-500 transition-colors";

export function CryptoPayDialog({ info, onClose, onCredited }: { info: EntitlementInfo; onClose: () => void; onCredited: () => void }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<CryptoOptions | null>(null);
  const [product, setProduct] = useState<PremiumProduct>("monthly");
  const [method, setMethod] = useState(0);
  const [intent, setIntent] = useState<CryptoIntent | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void getCryptoOptions().then((r) => {
      if (!r.ok) setError(t(payErrorKey(r.code)));
      else { setOptions(r.data); setReference(r.data.reference ?? ""); }
    });
  }, [t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function start() {
    const m = options?.methods[method];
    if (!m) return;
    setBusy(true); setError(null);
    const r = await createCryptoIntent({ product, chain: m.chain, token: m.token });
    setBusy(false);
    if (!r.ok) return setError(t(payErrorKey(r.code)));
    setIntent(r.intent); setReference(r.reference);
  }

  const price = info.products[product].priceUsd;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div role="dialog" aria-label={t("premium.pay.title")} className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-sm shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary">{t("premium.pay.title")}</h3>
          <button onClick={onClose} aria-label={t("common.close")} className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          {!options && !error && <div className="flex justify-center py-6"><Spinner /></div>}
          {error && <ErrorBox>{error}</ErrorBox>}
          {done && <p role="status" className="text-sm text-green-400">{t("premium.pay.credited")}</p>}
          {options && !intent && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(["monthly", "yearly"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setProduct(p)} aria-pressed={product === p}
                    className={`rounded-lg border py-3 text-center transition-colors ${product === p ? "border-blue-500 bg-blue-500/10" : "border-border-primary bg-surface-primary"}`}>
                    <p className="text-sm font-semibold text-text-primary">{t(p === "monthly" ? "premium.pay.month1" : "premium.pay.month12")}</p>
                    <p className="text-[11px] text-text-muted">${info.products[p].priceUsd}</p>
                  </button>
                ))}
              </div>
              <select aria-label={t("premium.pay.network")} className={FIELD} value={method} onChange={(e) => setMethod(Number(e.target.value))}>
                {options.methods.map((m, i) => <option key={`${m.chain}-${m.token}`} value={i}>{m.token} · {CHAIN_NAME[m.chain]}</option>)}
              </select>
              <p className="text-[11px] text-text-muted leading-relaxed">{t("premium.pay.noRenew", { price })}</p>
              {info.entitlement.apple?.autoRenew && <p className="text-[11px] text-yellow-500 leading-relaxed">{t("premium.pay.appleOverlap")}</p>}
              <Button fullWidth disabled={busy || options.methods.length === 0} onClick={() => void start()}>{busy ? t("common.loading") : t("premium.pay.continue")}</Button>
            </>
          )}
          {intent && !done && (
            <>
              <div className="flex flex-col items-center gap-3">
                <div className="bg-white rounded-xl p-3"><QRCodeSVG value={intent.treasury} size={160} level="M" /></div>
                <p className="text-xs font-medium text-text-secondary">{intent.token} · {CHAIN_NAME[intent.chain]}</p>
              </div>
              <div>
                <p className="text-[11px] text-text-muted">{t("premium.pay.address")}</p>
                <CopyableText value={intent.treasury} textClassName="font-mono text-xs break-all text-text-secondary" />
              </div>
              <div>
                <p className="text-[11px] text-text-muted">{t("premium.pay.amount")}</p>
                <CopyableText value={intent.amount} textClassName="font-mono text-sm font-semibold text-text-primary">{intent.amount} {intent.token}</CopyableText>
              </div>
              <p className="text-[11px] text-yellow-500 leading-relaxed">{t("premium.pay.exact")}</p>
              <p className="text-[11px] text-text-muted">{t("premium.pay.expires", { date: new Date(intent.expiresAt).toLocaleString() })}</p>
              <CryptoClaimForm intent={intent} onCredited={() => { setDone(true); onCredited(); }} />
            </>
          )}
          {reference && (
            <div>
              <p className="text-[11px] text-text-muted">{t("premium.pay.reference")}</p>
              <CopyableText value={reference} textClassName="font-mono text-xs text-text-secondary" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
