import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listSigners, takeOverSigning } from "../../lib/signer-api";
import { signerErrorMessage } from "../../lib/signer-error-message";
import { ErrorBox } from "../ui";

/** "Use this device for signing?": shown where signing would be, for a wallet this device can only view. */
export function ViewOnlyCard({ keyShareId, walletName }: { keyShareId: string; walletName?: string | null }) {
  const { t } = useTranslation();
  const dismissKey = `kx-signer-dismiss:${keyShareId}`;
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(dismissKey) === "1");
  const [activeLabel, setActiveLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void listSigners(keyShareId).catch(() => []).then((rows) => {
      if (live) setActiveLabel(rows.find((r) => r.status === "active")?.label ?? "");
    });
    return () => { live = false; };
  }, [keyShareId]);

  if (dismissed) return null;

  async function useThis() {
    setBusy(true);
    setError("");
    try {
      await takeOverSigning(keyShareId); // a removed key is replaced by a new one first
    } catch (err) {
      setError(signerErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border-primary bg-surface-secondary p-3 space-y-2 text-left">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">{t("signers.move.prompt.title")}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">{t("signers.device.viewOnly")}</span>
      </div>
      <p className="text-xs text-text-muted">
        {walletName ? `${walletName}: ` : ""}
        {activeLabel ? t("signers.viewOnly.body", { device: activeLabel }) : t("signers.move.prompt.body")}
      </p>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <button onClick={useThis} disabled={busy} className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60">{t("signers.useThis")}</button>
        <button
          onClick={() => { sessionStorage.setItem(dismissKey, "1"); setDismissed(true); }}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:bg-border-primary disabled:opacity-60"
        >{t("signers.keepOther", { device: activeLabel || t("signers.device.signing") })}</button>
      </div>
    </div>
  );
}
