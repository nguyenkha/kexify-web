import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { PassphraseInput } from "./PassphraseInput";
import { getKeyShareWithPassphrase } from "../lib/keystore";
import { KeyPassphraseCancelled, subscribeKeyPassphrase, type KeyPassphraseRequest } from "../lib/key-passphrase-prompt";

/** Asks for the passphrase of a passphrase-mode browser share when a flow is about to sign. */
export function KeyPassphraseHost() {
  const { t } = useTranslation();
  const [req, setReq] = useState<{ id: number; r: KeyPassphraseRequest } | null>(null);
  const nextId = useRef(0);
  useEffect(() => subscribeKeyPassphrase((r) => setReq(r ? { id: ++nextId.current, r } : null)), []);

  useEffect(() => {
    if (!req) return;
    const { id, r } = req;
    // Capture phase: Escape closes this prompt only, not the dialog underneath it.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setReq((cur) => (cur?.id === id ? null : cur));
      r.reject(new KeyPassphraseCancelled());
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req]);

  if (!req) return null;
  const { id, r } = req;
  // Only close our own request: a superseded one must not hide a newer one.
  const close = () => setReq((cur) => (cur?.id === id ? null : cur));
  const cancel = () => { close(); r.reject(new KeyPassphraseCancelled()); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={cancel} />
      <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
            <KeyRound className="w-4 h-4" />{t("signKey.passphraseTitle")}
          </h3>
          <button
            onClick={cancel}
            aria-label={t("common.cancel")}
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 space-y-3">
          <p className="text-xs text-text-muted">{t("signKey.passphrasePrompt")}</p>
          <PassphraseInput
            key={id}
            mode="enter"
            submitLabel={t("common.continue")}
            onSubmit={async (passphrase) => {
              // A wrong passphrase throws; PassphraseInput shows it and the prompt stays open.
              const kf = await getKeyShareWithPassphrase(r.keyId, passphrase);
              if (!kf) throw new Error(t("signKey.noStoredShare"));
              close();
              r.resolve(kf);
            }}
          />
        </div>
      </div>
    </div>
  );
}
