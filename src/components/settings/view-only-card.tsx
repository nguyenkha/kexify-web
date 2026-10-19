import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getSignerRecord } from "../../lib/device-signer-key";
import { listSigners, SignerApiError, takeOverSigning, type SignerRow } from "../../lib/signer-api";
import { signerErrorMessage } from "../../lib/signer-error-message";
import { ErrorBox } from "../ui";
import { SignerCoolingWait } from "./signer-cooling-wait";

/** "Use this device for signing?": shown where signing would be, for a wallet this device can only view. */
export function ViewOnlyCard({ keyShareId, walletName }: { keyShareId: string; walletName?: string | null }) {
  const { t } = useTranslation();
  const dismissKey = `kx-signer-dismiss:${keyShareId}`;
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(dismissKey) === "1");
  const [activeLabel, setActiveLabel] = useState("");
  const [mine, setMine] = useState<SignerRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noDecliner, setNoDecliner] = useState(false);

  const load = useCallback(async () => {
    const rows = await listSigners(keyShareId).catch(() => [] as SignerRow[]);
    const rec = await getSignerRecord(keyShareId).catch(() => null);
    setActiveLabel(rows.find((r) => r.status === "active")?.label ?? "");
    setMine(rows.find((r) => r.id === rec?.signerId) ?? null);
  }, [keyShareId]);
  useEffect(() => { void load(); }, [load]);
  const reload = useCallback(() => { void load(); }, [load]);

  // Waiting out the safety period after a passkey restore: shown even when the prompt was dismissed.
  if (mine?.cooling) return <SignerCoolingWait keyShareId={keyShareId} signer={mine} onChanged={reload} />;
  if (dismissed) return null;

  async function useThis() {
    setBusy(true);
    setError("");
    setNoDecliner(false);
    try {
      await takeOverSigning(keyShareId); // a removed key is replaced by a new one first
      await load(); // a passkey hand-over comes back waiting (cooling)
    } catch (err) {
      // Anonymous wallet with nobody who could stop a passkey move: only a backup restore is safe.
      if (err instanceof SignerApiError && err.code === "NO_DECLINER") setNoDecliner(true);
      else setError(signerErrorMessage(err, t));
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
      {noDecliner && (
        <ErrorBox>
          {t("signers.error.noDecliner")}{" "}
          <Link to="/recovery" className="underline">{t("signers.error.noDeclinerLink")}</Link>
        </ErrorBox>
      )}
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
