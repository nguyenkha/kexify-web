// Lock of a wallet without an account (phase 4b). Locked: red banner "This wallet is locked" + Unlock (the signing
// device unlocks at once; any other device with a passkey, after a wait set by the server). Not locked: "Lock this wallet" in the
// sidebar (or "Add a passkey first" when the server says it could never be unlocked). The unlock time comes from the
// server (72 h for a passkey unlock). Account wallets use FrozenBanner instead.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, LockOpen } from "lucide-react";
import type { MeStandalone } from "../lib/auth";
import { moveErrorMessage } from "../lib/device-move/move-error-message";
import { cancelWalletUnlock, isActiveSigner, lockWallet, unlockWalletFromSigner, unlockWalletWithPasskey } from "../lib/wallet-freeze-api";
import { Button, ErrorBox } from "./ui";
import { ConfirmDialog } from "./ui/confirm-dialog";

/** Server answers that only mean our view is stale: refresh instead of showing an error. */
const STALE = ["NOT_FROZEN", "UNFREEZE_SCHEDULED"];

function useLockAction(onUpdate: () => void) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onUpdate();
    } catch (err) {
      if (STALE.includes(String((err as { code?: unknown })?.code ?? ""))) onUpdate();
      else setError(moveErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function WalletLockBanner({ wallet, onUpdate }: { wallet: MeStandalone; onUpdate: () => void }) {
  const { t } = useTranslation();
  const { busy, error, run } = useLockAction(onUpdate);
  const id = wallet.keyShareId;
  const unlock = () => run(async () => {
    if (await isActiveSigner(id)) await unlockWalletFromSigner(id);
    else await unlockWalletWithPasskey(id);
  });

  return (
    <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-red-400 flex items-center gap-1.5"><Lock className="w-4 h-4" />{t("wallet.locked.title")}</h3>
      <p className="text-xs text-text-secondary">{t("wallet.locked.body")}</p>
      {wallet.unfreezeAt && <p className="text-xs text-text-tertiary">{t("wallet.locked.unlockAt", { time: new Date(wallet.unfreezeAt).toLocaleString() })}</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2 pt-1">
        {wallet.unfreezeAt ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => cancelWalletUnlock(id))}>{t("freeze.cancel")}</Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={unlock}><LockOpen className="w-3.5 h-3.5 mr-1 inline" />{t("wallet.locked.unlock")}</Button>
        )}
      </div>
    </div>
  );
}

export function LockWalletButton({ keyShareId, onUpdate }: { keyShareId: string; onUpdate: () => void }) {
  const { t } = useTranslation();
  const { busy, error, run } = useLockAction(onUpdate);
  const [confirm, setConfirm] = useState(false);
  const [noPath, setNoPath] = useState(false);
  // No signing device and no passkey: a lock could never be undone, so the server refuses it.
  if (noPath) return <p className="px-3 py-1.5 text-xs text-text-muted">{t("wallet.lockNoPath")}</p>;
  const lock = () => run(async () => {
    try { await lockWallet(keyShareId); } catch (err) {
      if ((err as { code?: string })?.code === "NO_UNLOCK_PATH") { setNoPath(true); return; }
      throw err;
    }
  });
  return (
    <>
      <button
        disabled={busy}
        onClick={() => setConfirm(true)}
        className="w-full text-left px-3 py-1.5 rounded-md text-xs text-red-400 hover:bg-red-500/10 transition-colors"
      >
        <Lock className="w-3.5 h-3.5 inline-block align-[-2px] mr-1.5" />{t("wallet.lockAction")}
      </button>
      {error && <ErrorBox className="mx-3">{error}</ErrorBox>}
      <ConfirmDialog
        open={confirm}
        message={t("wallet.lockConfirm")}
        confirmLabel={t("wallet.lockAction")}
        destructive
        onConfirm={() => { setConfirm(false); void lock(); }}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
