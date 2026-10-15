import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthError, verifyCode } from "../lib/auth";
import { authErrorMessage } from "../lib/auth-error-message";
import { ErrorBox } from "./ui";

interface LoginCodeFormProps {
  email: string;
  /** Called after a valid code; the session token is already stored. */
  onVerified: () => void;
}

/** Sign-in step 2: 6-digit code, auto-submits on the 6th digit (UX spec sign-in.md). */
export function LoginCodeForm({ email, onVerified }: LoginCodeFormProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(value: string) {
    if (value.length !== 6 || verifying || locked) return;
    setVerifying(true);
    setError("");
    try {
      await verifyCode(email, value);
      onVerified();
    } catch (err) {
      setError(authErrorMessage(err, t));
      setCode("");
      if (err instanceof AuthError && err.code === "codeLocked") setLocked(true);
      else requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setVerifying(false);
    }
  }

  function handleChange(raw: string) {
    const value = raw.replace(/\D/g, "").slice(0, 6);
    setCode(value);
    if (error) setError("");
    if (value.length === 6) submit(value);
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(code); }}
      className="space-y-3"
    >
      <label htmlFor="login-code" className="block text-text-muted text-xs text-center">
        {t("login.codePrompt")}
      </label>
      <input
        id="login-code"
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        disabled={verifying || locked}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={t("login.codePlaceholder")}
        aria-invalid={!!error}
        className="w-full bg-surface-secondary border border-border-primary rounded-lg px-3 py-2.5 text-center text-2xl font-mono tracking-[0.3em] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500 disabled:opacity-60 transition-colors"
      />
      <button
        type="submit"
        disabled={code.length !== 6 || verifying || locked}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted disabled:cursor-not-allowed px-4 py-2.5 rounded-lg text-sm font-medium transition-colors text-white"
      >
        {verifying ? t("login.verifying") : t("login.verifyCode")}
      </button>
      {error && <div role="alert"><ErrorBox>{error}</ErrorBox></div>}
    </form>
  );
}
