// Home: a move that did not hear back from its commit and could not be settled on its own. "Finish moving
// signing here" retries the commit with the pending copy (one passkey tap, or the backup password).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listPendingShares } from "../../lib/keystore";
import { authenticatePasskey } from "../../lib/passkey";
import { reconcilePendingShares, settlePendingShare } from "../../lib/device-move/move-new-device";
import { moveErrorMessage } from "../../lib/device-move/move-error-message";
import { pendingNeedsPassword, retryPendingCommit } from "../../lib/device-move/move-pending-retry";
import { PassphraseInput } from "../PassphraseInput";
import { ErrorBox } from "../ui";

const BACKUP_CODES = ["BACKUP_REQUIRED", "ENVELOPE_REFUSED"];

export function PendingMoveCard() {
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The backup was refused: the user may go on without one (noBackup). Held only while this card is shown.
  const [skip, setSkip] = useState<{ keyId: string; passphrase?: string } | null>(null);

  const refresh = () => setIds(listPendingShares().map((p) => p.keyId));
  useEffect(() => { void reconcilePendingShares().finally(refresh); }, []);

  async function finish(keyId: string, passphrase?: string, noBackup = false) {
    setBusy(true);
    setError("");
    setSkip(null);
    try {
      // Settled on the server meanwhile: no passkey tap needed.
      const v = await settlePendingShare(keyId);
      if (v !== "promote" && v !== "drop") {
        if (passphrase) await retryPendingCommit(keyId, { passphrase }, { noBackup });
        else {
          const a = await authenticatePasskey({ withPrf: true });
          if (!a.prfKey || !a.credentialId) throw Object.assign(new Error("prf"), { code: "BACKUP_OPEN_FAILED" });
          await retryPendingCommit(keyId, { prfKey: a.prfKey, credentialId: a.credentialId, rpId: a.rpId }, { noBackup });
        }
      }
      setAsking(null);
    } catch (err) {
      setError(moveErrorMessage(err, t));
      if (BACKUP_CODES.includes(String((err as { code?: string }).code))) setSkip({ keyId, passphrase });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  if (ids.length === 0) return null;
  return (
    <div className="w-full mt-3 rounded-lg border border-border-primary bg-surface-secondary p-3 space-y-2 text-left">
      {ids.map((id) => (
        <div key={id} className="space-y-2">
          <button disabled={busy} onClick={() => (pendingNeedsPassword(id) ? setAsking(id) : finish(id))}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60">{t("move.finishHere")}</button>
          {asking === id && <PassphraseInput mode="enter" onSubmit={(p) => finish(id, p)} />}
        </div>
      ))}
      {error && <ErrorBox>{error}</ErrorBox>}
      {skip && (
        <button disabled={busy} onClick={() => finish(skip.keyId, skip.passphrase, true)}
          className="text-xs px-3 py-1.5 rounded bg-yellow-500/10 text-yellow-500 disabled:opacity-60">{t("move.skipBackup")}</button>
      )}
    </div>
  );
}
