import { useState } from "react";
import { useTranslation } from "react-i18next";
import { markKitVerified } from "../lib/protection-status";

/**
 * Verify step after a backup file was saved (UX spec: backup-export-restore.md step 4).
 * The user re-types the passphrase; only on a match is the wallet's kit "verified".
 * Local check, so no lockout. Closing the step without a match records nothing.
 */
export function KitVerifyStep({
  keyId,
  passphrase,
  onVerified,
}: {
  keyId: string;
  passphrase: string;
  onVerified?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [verified, setVerified] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (value !== passphrase) {
      setError(true);
      return;
    }
    markKitVerified(keyId);
    setVerified(true);
    onVerified?.();
  }

  if (verified) {
    return (
      <div className="flex items-center gap-2.5 px-1" role="status">
        <div className="w-5 h-5 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
          <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <p className="text-[11px] text-green-400">{t("kit.verified")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border border-border-primary rounded-lg p-3 space-y-2.5">
      <div>
        <p className="text-xs font-medium text-text-primary">{t("kit.verifyTitle")}</p>
        <p className="text-[11px] text-text-muted leading-relaxed mt-0.5">{t("kit.verifyBody")}</p>
      </div>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(false); }}
        placeholder={t("common.passphrase")}
        aria-invalid={error}
        className="w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-blue-500 transition-colors"
      />
      {error && <p className="text-[11px] text-red-400" role="alert">{t("recovery.incorrectPassphrase")}</p>}
      <button
        type="submit"
        disabled={!value}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
      >
        {t("kit.verify")}
      </button>
    </form>
  );
}
