// On the ACTIVE signing device: "Allow passkey "{name}" to restore this wallet?" for each of the owner's passkeys
// that has no backup yet. Allow unlocks this browser's copy (passkey tap or password) and seals it to that passkey;
// Not now asks again the next time the app is opened. Passkeys this tab itself just used are never asked: they
// are allowed silently (after a move, or together with the next Allow).
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound } from "lucide-react";
import { allowOwnPasskeysSilently, allowPasskeyRestore, BACKUP_RECIPIENTS_EVENT, findAllowRequests, type AllowRequest } from "../../lib/backup-passkey-allow";
import { ownEscrowKeyMatches, passkeyAssertedHere } from "../../lib/passkey-escrow-key";
import { unlockKeyFile } from "../../lib/device-move/move-old-device";
import { moveErrorMessage } from "../../lib/device-move/move-error-message";
import { Button, ErrorBox } from "../ui";

const POLL_MS = 5 * 60_000;
const reqKey = (r: AllowRequest) => `${r.keyShareId}:${r.recipient.credentialId}`;

export function AllowPasskeyPrompt() {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<AllowRequest[]>([]);
  const [later, setLater] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setRequests(await findAllowRequests()); } catch { /* offline: next check */ }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 1500); // after the shell settled; never on top of a login prompt
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setLater(new Set()); // opened again: ask again
      void refresh();
    };
    const onChanged = () => void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(BACKUP_RECIPIENTS_EVENT, onChanged);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(BACKUP_RECIPIENTS_EVENT, onChanged);
    };
  }, [refresh]);

  const current = requests.find((r) => !later.has(reqKey(r)) && !passkeyAssertedHere(r.recipient.credentialId));
  if (!current) return null;
  const name = current.recipient.name || t("backup.allowPasskey.unnamed");

  async function allow(req: AllowRequest) {
    setBusy(true);
    setError("");
    try {
      const keyFile = await unlockKeyFile(req.keyShareId);
      // The unlock tap may have used this very passkey: then its key derived here must equal the one shown, or
      // someone else pinned it (never wrap to it, show nothing). Any other passkey: exactly the key shown.
      if (passkeyAssertedHere(req.recipient.credentialId) && !ownEscrowKeyMatches(req.recipient.credentialId, req.recipient.escrowKey)) {
        console.warn("[backup] escrow key on the server differs from this passkey's: not allowing it");
        notNow(req);
        return;
      }
      await allowPasskeyRestore(req.keyShareId, req.recipient, keyFile, req.generation);
      await allowOwnPasskeysSilently(req.keyShareId, keyFile);
      await refresh();
    } catch (err) {
      // A move / lock / removal landed meanwhile: read the list again instead of showing an error.
      if ((err as { code?: string })?.code === "STATE_CHANGED") await refresh();
      else setError(moveErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  function notNow(req: AllowRequest) {
    setError("");
    setLater((s) => new Set(s).add(reqKey(req)));
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 px-4">
      <div role="alertdialog" aria-modal="true" className="w-full max-w-sm bg-surface-secondary border border-border-primary rounded-xl p-5 shadow-xl space-y-3">
        <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-blue-400" />
        </div>
        <h2 className="text-base font-semibold text-text-primary leading-snug">{t("backup.allowPasskey.title", { name })}</h2>
        {current.walletName && <p className="text-xs text-text-muted">{t("restore.ask.wallet", { name: current.walletName })}</p>}
        <p className="text-xs text-text-muted leading-relaxed">{t("backup.allowPasskey.body")}</p>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="space-y-2 pt-1">
          <Button fullWidth disabled={busy} onClick={() => allow(current)}>{t("backup.allowPasskey.allow")}</Button>
          <Button variant="ghost" fullWidth disabled={busy} onClick={() => notNow(current)}>{t("backup.allowPasskey.later")}</Button>
        </div>
      </div>
    </div>
  );
}
