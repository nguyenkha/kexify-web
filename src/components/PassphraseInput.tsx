import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBox, Spinner } from "./ui";

/** Minimum length when CREATING a passphrase (backup file, local encryption). Decrypt accepts any length. */
export const MIN_PASSPHRASE_LENGTH = 12;

interface PassphraseInputProps {
  mode: "set" | "enter";
  onSubmit: (passphrase: string) => Promise<void>;
  error?: string;
  submitLabel?: string;
  hideHint?: boolean;
}

export function PassphraseInput({ mode, onSubmit, error, submitLabel, hideHint }: PassphraseInputProps) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  const displayError = error || localError;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!passphrase) return;

    if (mode === "set") {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        setLocalError(t("kit.tooShort"));
        return;
      }
      if (passphrase !== confirm) {
        setLocalError(t("kit.mismatch"));
        return;
      }
    }

    setLocalError("");
    setLoading(true);
    try {
      await onSubmit(passphrase);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const label = submitLabel ?? (mode === "set" ? t("kit.encrypt") : t("kit.decrypt"));

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === "set" && !hideHint && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-yellow-500">
            {t("kit.hint")}
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs text-text-tertiary mb-1.5">
          {mode === "set" ? t("kit.setPassphrase") : t("kit.enterPassphrase")}
        </label>
        <div className="relative">
        <input
          autoFocus
          type={show ? "text" : "password"}
          autoComplete={mode === "set" ? "new-password" : "current-password"}
          value={passphrase}
          onChange={(e) => { setPassphrase(e.target.value); setLocalError(""); }}
          placeholder={t("common.passphrase")}
          className="w-full bg-surface-primary border border-border-primary rounded-lg pl-3 pr-14 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-blue-500 transition-colors"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute inset-y-0 right-0 px-3 text-[11px] text-text-muted hover:text-text-secondary"
        >
          {show ? t("kit.hide") : t("kit.show")}
        </button>
        </div>
      </div>

      {mode === "set" && (
        <div>
          <label className="block text-xs text-text-tertiary mb-1.5">{t("kit.confirmPassphrase")}</label>
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setLocalError(""); }}
            placeholder={t("kit.confirmPassphrase")}
            className="w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      )}

      {displayError && <ErrorBox>{displayError}</ErrorBox>}

      <button
        type="submit"
        disabled={loading || !passphrase || (mode === "set" && !confirm)}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        {loading && <Spinner size="sm" className="border-white border-t-transparent" />}
        {loading ? t("kit.processing") : label}
      </button>
    </form>
  );
}
