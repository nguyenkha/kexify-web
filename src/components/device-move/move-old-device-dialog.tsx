// Old device, screen 3a right side: scan (or paste, or pick by fingerprint), check the server's keys equal the
// QR's, show the server-checked facts + a 6-digit code, then Confirm (one passkey tap) or Not me.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scanner } from "@yudiel/react-qr-scanner";
import { signOut } from "../../lib/auth";
import { timeAgo } from "../../lib/device-facts";
import { listOpenTransfers, type TransferView } from "../../lib/device-move/move-api";
import { moveErrorMessage } from "../../lib/device-move/move-error-message";
import { approveMove, formatMoveCode, loadScannedTransfer, newMoveCode, rejectMove } from "../../lib/device-move/move-old-device";
import { moveFingerprint, parseMoveQr } from "../../lib/device-move/move-qr-text";
import { ErrorBox } from "../ui";

const DAY_MS = 24 * 60 * 60 * 1000;

export function MoveOldDeviceDialog({ keyShareId, onClose }: { keyShareId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [transfer, setTransfer] = useState<TransferView | null>(null);
  const [code] = useState(newMoveCode);
  const [paste, setPaste] = useState("");
  const [open, setOpen] = useState<TransferView[] | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await fn(); } catch (err) { setError(moveErrorMessage(err, t)); } finally { setBusy(false); }
  }

  const fromText = (text: string) => run(async () => {
    const qr = parseMoveQr(text);
    if (!qr) throw Object.assign(new Error("QR_MISMATCH"), { code: "QR_MISMATCH" });
    setTransfer(await loadScannedTransfer(qr));
  });

  const loginAge = (at: string | null) => !at ? t("move.notSignedIn")
    : Date.now() - Date.parse(at) < DAY_MS ? t("move.newLogin") : t("move.signedIn", { time: timeAgo(at, i18n.language) });

  const btn = "text-xs px-3 py-1.5 rounded disabled:opacity-60";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={busy ? undefined : onClose} />
      <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-md p-5 space-y-3 text-left">
        {!transfer && (
          <>
            <h3 className="text-sm font-semibold text-text-primary">{t("move.scan.title")}</h3>
            <div className="rounded-lg overflow-hidden">
              <Scanner onScan={(r) => { if (r?.[0]?.rawValue && !busy) void fromText(r[0].rawValue); }} onError={() => {}} />
            </div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void fromText(paste); }}>
              <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t("move.scan.paste")}
                className="flex-1 min-w-0 text-xs px-3 py-2 rounded-lg bg-surface-primary border border-border-primary text-text-primary" />
              <button type="submit" disabled={busy || !paste} className={`${btn} bg-blue-600 text-white`}>{t("move.scan.check")}</button>
            </form>
            <button className="text-xs underline text-text-muted" disabled={busy} onClick={() => run(async () => setOpen(await listOpenTransfers()))}>{t("move.scan.list")}</button>
            {open && open.length === 0 && <p className="text-xs text-text-muted">{t("move.scan.none")}</p>}
            {open?.map((o) => (
              <button key={o.transferId} onClick={() => setTransfer(o)} className="w-full text-left text-xs px-3 py-2 rounded border border-border-primary text-text-secondary">
                <LocalFingerprint view={o} /> . {o.device.label ?? o.device.platform ?? ""}
              </button>
            ))}
          </>
        )}
        {transfer && !sent && (
          <>
            <h3 className="text-sm font-semibold text-text-primary">{t("move.confirm.title")}</h3>
            <p className="text-xs text-text-secondary">
              {t("move.confirm.body", { platform: transfer.device.label ?? transfer.device.platform ?? "", country: transfer.device.country ?? "", loginAge: loginAge(transfer.device.loginAt) })}
            </p>
            <p className="text-sm font-mono text-text-primary">{t("move.code.show", { code: formatMoveCode(code) })}</p>
            <div className="flex gap-2">
              <button disabled={busy} className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}
                onClick={() => run(async () => { await approveMove(keyShareId, transfer, code); setSent(true); })}>{t("move.confirm.confirm")}</button>
              <button disabled={busy} className={`${btn} bg-red-500/10 text-red-400`}
                onClick={() => run(async () => {
                  const { frozen } = await rejectMove(keyShareId, transfer.transferId);
                  if (frozen) { alert(t("move.locked")); signOut({ sessionEnded: true }); } else onClose();
                })}>{t("move.confirm.notMe")}</button>
            </div>
          </>
        )}
        {sent && (
          <>
            <p className="text-sm font-mono text-text-primary">{t("move.code.show", { code: formatMoveCode(code) })}</p>
            <p className="text-xs text-text-muted">{t("move.code.keep")}</p>
            <button className={`${btn} bg-surface-tertiary text-text-secondary`} onClick={onClose}>{t("move.qr.submit")}</button>
          </>
        )}
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </div>
  );
}

/** The no-camera code, computed here from the keys the server holds (never the server's own string). */
function LocalFingerprint({ view }: { view: TransferView }) {
  const [fp, setFp] = useState("");
  useEffect(() => {
    let live = true;
    void moveFingerprint(view.devicePubkey, view.ephPubkey, view.nonce).then((v) => { if (live) setFp(v); });
    return () => { live = false; };
  }, [view.devicePubkey, view.ephPubkey, view.nonce]);
  return <span className="font-mono">{fp}</span>;
}
