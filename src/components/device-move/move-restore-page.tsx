// Screen 3b (route /move/restore/:keyId): "I don't have it". Register this device with a passkey, wait out the
// safety period (or the old device says "Yes, it's me"), then open the backup here and re-key automatically.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getSignerRecord } from "../../lib/device-signer-key";
import { listSigners, type SignerRow } from "../../lib/signer-api";
import { moveErrorMessage } from "../../lib/device-move/move-error-message";
import { finishMove, hadBackup, keepClaimedShare, walletPublicKey, type ShareLock } from "../../lib/device-move/move-new-device";
import { blobNeedsPassword, decryptRestoreBackup, markRestorePending, openRestoreBackup, restorePending, startRestore } from "../../lib/device-move/move-restore";
import type { MoveSigner, StagedRefresh } from "../../lib/device-move/move-share-refresh";
import { fetchBackupStatus, type EscrowBlob } from "../../lib/escrow-download";
import { PassphraseInput } from "../PassphraseInput";
import { SignerCoolingWait } from "../settings/signer-cooling-wait";
import { ErrorBox } from "../ui";

type Phase = "load" | "intro" | "cooling" | "ready" | "password" | "working" | "done" | "error";
const BACKUP_CODES = ["BACKUP_REQUIRED", "ENVELOPE_REFUSED"];
const FILE_ONLY = ["NO_DECLINER", "NO_BACKUP", "PASSWORD_BACKUP_REQUIRED"];

export function MoveRestorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { keyId = "" } = useParams();
  const [phase, setPhase] = useState<Phase>("load");
  const [mine, setMine] = useState<SignerRow | null>(null);
  const [error, setError] = useState("");
  const [fileOnly, setFileOnly] = useState(false);
  const blob = useRef<EscrowBlob | null>(null);
  const staged = useRef<{ run: (noBackup?: boolean) => Promise<void> } | null>(null);
  const [canSkip, setCanSkip] = useState(false);
  const [pwError, setPwError] = useState("");
  useEffect(() => () => { blob.current = null; staged.current = null; }, []); // the verified password lives only in these closures

  const load = useCallback(async () => {
    const rec = await getSignerRecord(keyId).catch(() => null);
    const rows = await listSigners(keyId).catch(() => [] as SignerRow[]);
    const me = rows.find((r) => r.id === rec?.signerId) ?? null;
    setMine(me);
    if (me?.status === "revoked" && me.revokeReason === "no_backup") { markRestorePending(keyId, false); setFileOnly(true); setError(t("restore.noBackupLeft")); setPhase("error"); return; }
    // This browser already signs for the wallet: nothing to restore here.
    if (me?.status === "active" && !restorePending(keyId)) { setError(t("restore.alreadySigning")); setPhase("error"); return; }
    setError(""); // a step that went on clears the banner of an earlier failed one
    setFileOnly(false);
    setPhase(me?.cooling ? "cooling" : me?.status === "active" ? "ready" : "intro");
  }, [keyId, t]);
  useEffect(() => { void load(); }, [load]);

  function fail(err: unknown) {
    const code = String((err as { code?: unknown })?.code ?? "");
    setFileOnly(FILE_ONLY.includes(code));
    setError(moveErrorMessage(err, t));
  }

  async function begin() {
    setError("");
    try { await startRestore(keyId); await load(); } catch (err) { fail(err); }
  }

  /** Decrypt, keep it here, then re-key + backup + commit as the active signer. Retry repeats only the commit. */
  async function complete(password?: string) {
    setPhase("working");
    setError("");
    try {
      const keyFile = await decryptRestoreBackup(keyId, blob.current!, password);
      const want = await walletPublicKey(keyId);
      if (!want || want.toLowerCase() !== keyFile.publicKey.toLowerCase()) throw Object.assign(new Error("x"), { code: "BACKUP_OPEN_FAILED" });
      const b = blob.current!;
      const lock: ShareLock = b.prfKey && b.credentialId ? { prfKey: b.prfKey, credentialId: b.credentialId, rpId: b.rpId } : { passphrase: password! };
      const rec = (await getSignerRecord(keyId)) as MoveSigner;
      await keepClaimedShare(keyFile, lock);
      const backedUp = await hadBackup(keyId);
      let s: StagedRefresh | undefined;
      const run = async (noBackup = false) => {
        try { await finishMove({ keyFile, signer: rec, lock, backedUp, staged: s, password, noBackup }); }
        catch (err) { s = (err as { staged?: StagedRefresh }).staged; setCanSkip(!!s && BACKUP_CODES.includes(String((err as { code?: string }).code))); throw err; }
      };
      staged.current = { run };
      await run();
      markRestorePending(keyId, false);
      setPhase("done");
    } catch (err) {
      fail(err);
      setPhase("error");
    }
  }

  /**
   * The typed backup password must open the EXISTING password backup before anything is sealed with it: the
   * served password blob, or (passkey blob served) the password envelope fetched on its own. Once verified it
   * stays in memory for retries only.
   */
  async function submitPassword(p: string) {
    setPwError("");
    setError("");
    try {
      const b = blob.current!;
      const pwBlob = blobNeedsPassword(b) ? b : await openRestoreBackup(keyId, { passwordOnly: true });
      await decryptRestoreBackup(keyId, pwBlob, p);
    } catch (err) {
      const code = String((err as { code?: unknown })?.code ?? "");
      if (code === "BACKUP_OPEN_FAILED") setPwError(t("restore.passwordWrong"));
      else fail(err);
      return;
    }
    await complete(p);
  }

  async function openBackup() {
    setError("");
    try {
      blob.current = await openRestoreBackup(keyId);
      // A password backup existed: ask it, so the new backup keeps a password copy too (PRF blob or not).
      const status = await fetchBackupStatus(keyId);
      if (blobNeedsPassword(blob.current) || status?.password) setPhase("password");
      else await complete();
    } catch (err) { fail(err); }
  }

  async function retry(noBackup = false) {
    if (!staged.current) return void load();
    setPhase("working");
    setError("");
    setCanSkip(false);
    try { await staged.current.run(noBackup); markRestorePending(keyId, false); setPhase("done"); } catch (err) { fail(err); setPhase("error"); }
  }

  const primary = "w-full text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white";
  return (
    <div className="max-w-sm mx-auto mt-10 p-5 rounded-2xl border border-border-primary bg-surface-secondary space-y-4 text-center">
      {(phase === "intro" || phase === "ready") && (
        <>
          <h1 className="text-base font-semibold text-text-primary">{t("restore.title")}</h1>
          <button className={primary} onClick={phase === "intro" ? begin : openBackup}>{t("restore.continue")}</button>
        </>
      )}
      {phase === "cooling" && mine && <SignerCoolingWait keyShareId={keyId} signer={mine} onChanged={() => void load()} />}
      {phase === "password" && (
        <>
          <p className="text-sm text-text-primary">{t("restore.password")}</p>
          <PassphraseInput mode="enter" error={pwError} onSubmit={submitPassword} />
        </>
      )}
      {phase === "working" && <p className="text-sm text-text-primary">{t("move.working")}</p>}
      {phase === "done" && (
        <>
          <p className="text-sm font-medium text-text-primary">{t("move.done")}</p>
          <button className={primary} onClick={() => navigate("/accounts")}>{t("move.qr.submit")}</button>
        </>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      {phase === "error" && <button onClick={() => retry()} className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary">{t("move.retry")}</button>}
      {phase === "error" && canSkip && <button onClick={() => retry(true)} className="text-xs px-3 py-1.5 rounded bg-yellow-500/10 text-yellow-500">{t("move.skipBackup")}</button>}
      {(fileOnly || phase === "intro") && <div className="text-xs text-text-muted"><Link to="/recovery" className="underline">{t("move.useFile")}</Link></div>}
    </div>
  );
}
