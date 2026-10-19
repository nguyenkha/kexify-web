import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { isStandaloneJwt } from "../../lib/auth";
import { waitLeft } from "../../lib/device-facts";
import { listSigners, revokeSigner, type SignerRow } from "../../lib/signer-api";
import { signerErrorMessage } from "../../lib/signer-error-message";
import { ErrorBox } from "../ui";

const POLL_MS = 30_000;

/**
 * This device waits out the safety period after "Use this device" with a passkey: countdown to activeFrom,
 * who was told, and "Cancel restore" (removes this device's request). Checks the server every 30 s while visible
 * and when the tab comes back: the old device may approve early, decline, or the server clock may differ.
 */
export function SignerCoolingWait({ keyShareId, signer, onChanged }: { keyShareId: string; signer: SignerRow; onChanged: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const check = async () => {
      setNow(Date.now());
      const rows = await listSigners(keyShareId).catch(() => null); // a read after activeFrom completes the move
      const mine = rows?.find((r) => r.id === signer.id);
      if (live && rows && !mine?.cooling) onChanged(); // active, removed or stopped: the card changes
    };
    const tick = () => { if (document.visibilityState === "visible") void check(); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [keyShareId, signer.id, onChanged]);

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      await revokeSigner(keyShareId, signer.id);
      onChanged();
    } catch (err) {
      setError(signerErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border-primary bg-surface-secondary p-3 space-y-2 text-left">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-yellow-400 shrink-0" />
        <span className="text-sm font-medium text-text-primary">{t("restore.wait.title", { time: waitLeft(signer.activeFrom, t, now) })}</span>
      </div>
      <p className="text-xs text-text-muted">{t(isStandaloneJwt() ? "restore.wait.noticeAnon" : "restore.wait.notice")}</p>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button
        onClick={cancel}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary hover:bg-border-primary disabled:opacity-60"
      >{t("restore.cancel")}</button>
    </div>
  );
}
