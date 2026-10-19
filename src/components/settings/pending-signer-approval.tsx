import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { isStandaloneJwt, signOut } from "../../lib/auth";
import { countryName, platformName, timeAgo } from "../../lib/device-facts";
import { holdSessionEndRedirect } from "../../lib/session-ended";
import { activateSigner, declineSigner } from "../../lib/signer-api";
import { signerErrorMessage } from "../../lib/signer-error-message";
import { usePendingSignerRequests, type PendingSignerRequest } from "../../lib/use-pending-signer-requests";
import { Button, ErrorBox } from "../ui";

type Done = "locked" | "stopped" | null;

/**
 * On the ACTIVE signing device. A move in its waiting period (cooling) gets a blocking prompt: "No, stop it"
 * declines (an account is then locked and every session ends), "Yes, it's me" hands signing over now.
 * A plain new device (not cooling) is asked once, dismissible, and "Make signing device" needs a second confirm.
 */
export function PendingSignerApproval() {
  const { t, i18n } = useTranslation();
  const { current, dismiss, refresh } = usePendingSignerRequests();
  const [busy, setBusy] = useState(false);
  // Errors and the confirm step belong to one signer: a poll may swap `current` to another device meanwhile.
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [done, setDone] = useState<Done>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const anon = isStandaloneJwt();
  // Another device became current (poll / focus): drop the confirm step and error of the previous one.
  const currentId = current?.signer.id ?? null;
  const [shownId, setShownId] = useState(currentId);
  if (shownId !== currentId) {
    setShownId(currentId);
    setConfirmId(null);
    setError(null);
  }

  if (done === "locked") {
    return (
      <Shell>
        <h2 className="text-base font-semibold text-text-primary">{t("restore.stopped.lockedTitle")}</h2>
        <p className="text-xs text-text-muted leading-relaxed">{t("restore.stopped.lockedBody")}</p>
        <Button fullWidth onClick={() => signOut({ sessionEnded: true })}>{t("restore.stopped.signIn")}</Button>
      </Shell>
    );
  }
  if (done === "stopped") {
    return (
      <Shell>
        <h2 className="text-base font-semibold text-text-primary">{t("restore.stopped.title")}</h2>
        <Button fullWidth onClick={() => { setDone(null); void refresh(); }}>{t("common.done")}</Button>
      </Shell>
    );
  }
  if (!current) return null;

  const { walletName, signer } = current;
  const errorText = error?.id === signer.id ? error.text : "";
  const confirming = confirmId === signer.id;
  const country = countryName(signer.device?.country, i18n.language, t);
  const platform = platformName(signer.device?.platform, t);
  const device = signer.device?.label || platform;
  const age = signer.device?.loginAt ? timeAgo(signer.device.loginAt, i18n.language) : "";
  const cooling = !!signer.cooling;

  // Each action acts on the request captured when its button was shown, never on whatever is current later.
  async function run(req: PendingSignerRequest, fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError({ id: req.signer.id, text: signerErrorMessage(err, t) }); void refresh(); } finally { setBusy(false); }
  }
  const stop = (req: PendingSignerRequest) => run(req, async () => {
    const { frozen } = await declineSigner(req.keyShareId, req.signer.id);
    if (frozen) holdSessionEndRedirect(true); // every session ended: this screen says why, then signs out
    if (!req.signer.cooling) dismiss(req, true);
    setDone(frozen ? "locked" : "stopped");
  });
  const allow = (req: PendingSignerRequest) => run(req, async () => {
    await activateSigner(req.keyShareId, req.signer.id, true);
    setConfirmId(null);
    await refresh();
  });
  const noNote = cooling ? t(anon ? "restore.ask.noNoteAnon" : "restore.ask.noNote")
    : t(anon ? "restore.askNew.notMeNoteAnon" : "restore.askNew.notMeNoteAccount");

  if (confirming && !cooling) {
    const req = current;
    return (
      <Shell onClose={() => setConfirmId(null)}>
        <h2 className="text-base font-semibold text-text-primary">{t("restore.askNew.confirmTitle")}</h2>
        <p className="text-xs text-text-muted leading-relaxed">{t("restore.askNew.confirmBody", { device })}</p>
        {errorText && <ErrorBox>{errorText}</ErrorBox>}
        <Button fullWidth disabled={busy} onClick={() => allow(req)}>{t("signers.makeSigning")}</Button>
        <Button variant="secondary" fullWidth disabled={busy} onClick={() => setConfirmId(null)}>{t("common.cancel")}</Button>
      </Shell>
    );
  }

  return (
    <Shell onClose={cooling ? undefined : () => dismiss(current)}>
      <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
        <ShieldAlert className="w-5 h-5 text-red-400" />
      </div>
      <h2 className="text-base font-semibold text-text-primary leading-snug">
        {cooling ? t("restore.ask.title", { country, platform }) : t("restore.askNew.title", { country, platform })}
      </h2>
      <p className="text-xs text-text-secondary">
        {[signer.device?.label, platform, country, age && t("restore.ask.signedIn", { time: age })].filter(Boolean).join(" · ")}
      </p>
      {walletName && <p className="text-xs text-text-muted">{t("restore.ask.wallet", { name: walletName })}</p>}
      <p className="text-xs text-text-muted leading-relaxed">{cooling ? t("restore.ask.body") : t("restore.askNew.body")}</p>
      {errorText && <ErrorBox>{errorText}</ErrorBox>}
      <div className="space-y-2 pt-1">
        <Button variant="danger" fullWidth disabled={busy} onClick={() => stop(current)}>
          {cooling ? t("restore.ask.no") : t("restore.askNew.notMe")}
        </Button>
        <p className="text-[11px] text-text-muted text-center">{noNote}</p>
        <Button variant="secondary" fullWidth disabled={busy} onClick={cooling ? () => allow(current) : () => setConfirmId(signer.id)}>
          {cooling ? t("restore.ask.yes") : t("signers.makeSigning")}
        </Button>
        <Button variant="ghost" fullWidth disabled={busy} onClick={() => dismiss(current, !cooling)}>
          {cooling ? t("restore.ask.later") : t("restore.askNew.later")}
        </Button>
      </div>
    </Shell>
  );
}

/** Modal frame. Without `onClose` it blocks (no backdrop dismiss). */
function Shell({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm bg-surface-secondary border border-border-primary rounded-xl p-5 shadow-xl space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
