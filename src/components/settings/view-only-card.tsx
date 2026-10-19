import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { getSignerRecord } from "../../lib/device-signer-key";
import { deleteKeyShare, hasKeyShare } from "../../lib/keystore";
import { clientKeys } from "../../lib/client-key-cache";
import { restorePending } from "../../lib/device-move/move-restore";
import { listSigners, SignerApiError, takeOverSigning, type SignerRow } from "../../lib/signer-api";
import { signerErrorMessage } from "../../lib/signer-error-message";
import { ErrorBox } from "../ui";
import { SignerCoolingWait } from "./signer-cooling-wait";

/** "Use this device for signing?": shown where signing would be, for a wallet this device can only view. */
export function ViewOnlyCard({ keyShareId, walletName }: { keyShareId: string; walletName?: string | null }) {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
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
    const me = rows.find((r) => r.id === rec?.signerId) ?? null;
    setMine(me);
    // Signing moved away (the wallet was re-keyed in the same step): this copy can never sign again. Remove it,
    // so it is not offered as a kit or a backup either.
    if (me?.status === "revoked" && me.revokeReason === "moved" && hasKeyShare(keyShareId)) {
      clientKeys.delete(keyShareId);
      deleteKeyShare(keyShareId);
    }
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

  // A lost-device restore whose wait is over: open the backup here (screen 3b, last step).
  if (mine?.status === "active" && restorePending(keyShareId)) {
    return (
      <div className="rounded-lg border border-border-primary bg-surface-secondary p-3 space-y-2 text-left">
        <p className="text-xs text-text-muted">{walletName ? `${walletName}: ` : ""}{t("restore.title")}</p>
        <button onClick={() => navigate(`/move/restore/${keyShareId}`)} className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white">{t("restore.continue")}</button>
      </div>
    );
  }

  // Screen 4: signing moved away from this device by a QR move.
  if (mine?.status === "revoked" && mine.revokeReason === "moved") {
    return (
      <div className="rounded-lg border border-border-primary bg-surface-secondary p-3 space-y-2 text-left">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">{t("signers.device.viewOnly")}</span>
        <p className="text-xs text-text-muted">
          {walletName ? `${walletName}: ` : ""}
          {t("moved.title", { device: activeLabel || t("signers.device.signing"), date: mine.revokedAt ? new Date(mine.revokedAt).toLocaleDateString(i18n.language) : "" })}
        </p>
        <button onClick={() => navigate("/move")} className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white">{t("moved.action")}</button>
      </div>
    );
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
      <div className="flex flex-wrap gap-2">
        <button onClick={() => navigate("/move")} disabled={busy} className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60">{t("move.haveOld")}</button>
        <button onClick={hasKeyShare(keyShareId) ? useThis : () => navigate(`/move/restore/${keyShareId}`)} disabled={busy} className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:bg-border-primary disabled:opacity-60">{t("move.noOld")}</button>
      </div>
      <div className="flex gap-3 text-[11px] text-text-muted">
        <Link to="/recovery" className="underline">{t("move.useFile")}</Link>
        <button
          onClick={() => { sessionStorage.setItem(dismissKey, "1"); setDismissed(true); }}
          disabled={busy}
          className="underline disabled:opacity-60"
        >{t("move.notNow")}</button>
      </div>
    </div>
  );
}
