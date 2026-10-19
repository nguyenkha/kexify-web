import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { getIdentityId } from "../../lib/auth";
import { normalizeAlertEmail, setAlertEmail } from "../../lib/security-alerts-api";
import { signerErrorMessage } from "../../lib/signer-error-message";
import { ErrorBox } from "../ui";
import { ConfirmDialog } from "../ui/confirm-dialog";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/**
 * Anonymous wallet (no account email): optional address that only receives security alerts, never a login.
 * Saving needs this device's signing key or a passkey; the address is used once its confirm link is opened.
 */
export function AlertEmailSetting() {
  const { t } = useTranslation();
  const keyShareId = getIdentityId(); // a standalone session's subject is its wallet
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!keyShareId) return null;
  const valid = EMAIL_RE.test(normalizeAlertEmail(email));

  async function save(value: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const { pending } = await setAlertEmail(keyShareId!, value);
      setNote(pending ? t("anon.alertEmailCheckInbox") : t("anon.alertEmailRemoved"));
      setEmail("");
    } catch (err) {
      setError(signerErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 pt-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{t("anon.alertEmail")}</h2>
        <p className="text-xs text-text-muted mt-1">{t("anon.alertEmailBody")}</p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (valid) void save(email); }}
      >
        <div className="flex-1 flex items-center gap-2 rounded-lg border border-border-primary bg-surface-secondary px-3">
          <Mail className="w-4 h-4 text-text-muted shrink-0" />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("anon.alertEmailPlaceholder")}
            className="flex-1 bg-transparent py-2 text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !valid}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 shrink-0"
        >{t("anon.alertEmailSave")}</button>
      </form>
      <button
        type="button"
        onClick={() => setConfirmRemove(true)}
        disabled={busy}
        className="text-[11px] text-text-muted hover:text-text-secondary disabled:opacity-60"
      >{t("anon.alertEmailRemove")}</button>
      {note && <p className="text-xs text-green-400">{note}</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
      {/* No read-back of the current address exists, so removing is always offered but confirmed first. */}
      <ConfirmDialog
        open={confirmRemove}
        message={t("anon.alertEmailRemoveConfirm")}
        confirmLabel={t("anon.alertEmailRemove")}
        destructive
        onConfirm={() => { setConfirmRemove(false); void save(""); }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
