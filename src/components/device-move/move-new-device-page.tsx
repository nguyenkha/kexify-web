// New device, screen 3a (route /move): show the QR, wait for the old device, collect the wallet, then the
// automatic re-key. Works before any login (anonymous wallet: the approval logs this device in).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { authenticatePasskey } from "../../lib/passkey";
import { hasAnyToken } from "../../lib/auth";
import { waitLeft } from "../../lib/device-facts";
import { transferStatus } from "../../lib/device-move/move-api";
import { moveErrorMessage } from "../../lib/device-move/move-error-message";
import {
  backedUpFrom, claimMove, dropStaged, finishMove, forgetMove, keepClaimedShare, openClaim, startMove,
  type PendingMove, type ShareLock,
} from "../../lib/device-move/move-new-device";
import type { StagedRefresh } from "../../lib/device-move/move-share-refresh";
import { fetchBackupStatus } from "../../lib/escrow-download";
import type { KeyFileData } from "../../lib/crypto";
import type { MoveSigner } from "../../lib/device-move/move-share-refresh";
import { PassphraseInput } from "../PassphraseInput";
import { ErrorBox } from "../ui";
import { MoveCodeField } from "./move-code-field";

type Phase = "qr" | "wait" | "lock" | "password" | "working" | "done" | "error" | "stopped" | "expired";
/** Commit refused for the backup: the user may choose to go on without one (noBackup). */
const BACKUP_CODES = ["BACKUP_REQUIRED", "ENVELOPE_REFUSED"];
interface Claimed { keyFile: KeyFileData; signer: MoveSigner; lock?: ShareLock; backedUp?: boolean; staged?: StagedRefresh; password?: string }

export function MoveNewDevicePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [move, setMove] = useState<PendingMove | null>(null);
  const [phase, setPhase] = useState<Phase>("qr");
  const [releaseAt, setReleaseAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);
  const claimed = useRef<Claimed | null>(null);
  const claiming = useRef(false);
  const typedCode = useRef<string | undefined>(undefined);
  const lockWaiter = useRef<((lock: ShareLock) => void) | null>(null);
  const passwordWaiter = useRef<((password: string | undefined) => void) | null>(null);
  const [canSkipBackup, setCanSkipBackup] = useState(false);

  const begin = useCallback(async () => {
    setError("");
    setPhase("qr");
    try { setMove(await startMove()); } catch (err) { setError(moveErrorMessage(err, t)); }
  }, [t]);
  useEffect(() => { void begin(); }, [begin]);
  useEffect(() => () => { if (move) forgetMove(move); }, [move]);

  /** Re-key + commit; on a failed commit the staged copy is kept so Retry only repeats backup + commit. */
  const finish = useCallback(async (noBackup = false) => {
    const c = claimed.current!;
    setPhase("working");
    setError("");
    setCanSkipBackup(false);
    try {
      await finishMove({ keyFile: c.keyFile, signer: c.signer, lock: c.lock!, backedUp: !!c.backedUp, staged: c.staged, password: c.password, noBackup });
      c.staged = undefined;
      setPhase("done");
    } catch (err) {
      c.staged = (err as { staged?: StagedRefresh }).staged; // undefined after REFRESH_EXPIRED / INCOMPLETE: start over
      setCanSkipBackup(!!c.staged && BACKUP_CODES.includes(String((err as { code?: string }).code)));
      setError(moveErrorMessage(err, t));
      setPhase("error");
    }
  }, [t]);

  const collect = useCallback(async (m: PendingMove, code?: string) => {
    if (claiming.current || claimed.current) return;
    claiming.current = true;
    try {
      const claim = await claimMove(m, code);
      const opened = await openClaim(m, claim);
      claimed.current = opened;
      // One passkey tap keeps the wallet here and backs it up; without PRF the backup password is asked once.
      const auth = await authenticatePasskey({ withPrf: true }).catch(() => null);
      const lock: ShareLock = auth?.prfKey && auth.credentialId
        ? { prfKey: auth.prfKey, credentialId: auth.credentialId, rpId: auth.rpId }
        : await new Promise<ShareLock>((resolve) => { lockWaiter.current = resolve; setPhase("lock"); });
      await keepClaimedShare(opened.keyFile, lock);
      const status = await fetchBackupStatus(opened.keyFile.id);
      // The wallet had a backup password: ask one once (contract 4a 8b) so the new backup keeps a password copy, or
      // Skip (passkey + slot copies only). It cannot be checked against the old password backup here: that one is
      // served only to the active signer, and this device signs only after the commit. (Without PRF the password
      // just typed for this device already is that copy.)
      const password = "prfKey" in lock && status?.password
        ? await new Promise<string | undefined>((resolve) => { passwordWaiter.current = resolve; setPhase("password"); })
        : undefined;
      claimed.current = { ...opened, lock, backedUp: backedUpFrom(status), password };
      await finish();
    } catch (err) {
      const code2 = (err as { code?: string }).code;
      if (code2 === "TRANSFER_WAIT") { setReleaseAt((err as { releaseAt?: string }).releaseAt ?? null); setPhase("wait"); }
      else if (code2 === "TRANSFER_CODE_WRONG") { typedCode.current = undefined; setError(t("move.codeWrong")); } // never resend a wrong code (5 = locked)
      else { setError(moveErrorMessage(err, t)); setPhase(claimed.current ? "error" : code2 === "TRANSFER_EXPIRED" ? "expired" : "error"); }
    } finally {
      claiming.current = false;
    }
  }, [finish, t]);

  // Poll while the QR is up (2 s); collect once approved, and again when the safety wait is over.
  useEffect(() => {
    if (!move || (phase !== "qr" && phase !== "wait")) return;
    const id = setInterval(async () => {
      setTick((n) => n + 1);
      if (phase === "wait") { if (releaseAt && Date.parse(releaseAt) <= Date.now()) void collect(move, typedCode.current); return; }
      if (Date.parse(move.expiresAt) < Date.now()) { setPhase("expired"); return; }
      const s = await transferStatus(move.transferId).catch(() => null);
      if (s?.status === "approved") void collect(move, typedCode.current);
      else if (s?.status === "rejected") setPhase("stopped");
    }, 2000);
    return () => clearInterval(id);
  }, [move, phase, releaseAt, collect]);
  useEffect(() => () => dropStaged(claimed.current?.staged), []);

  const box = "max-w-sm mx-auto mt-10 p-5 rounded-2xl border border-border-primary bg-surface-secondary space-y-4 text-center";
  return (
    <div className="min-h-screen bg-surface-primary px-4">
      <div className={box}>
        {phase === "qr" && (
          <>
            <h1 className="text-base font-semibold text-text-primary">{t("move.qr.title")}</h1>
            {move ? <div className="bg-white p-3 rounded-lg inline-block"><QRCodeSVG value={move.qrText} size={220} level="M" /></div>
              : !error && <p className="text-xs text-text-muted">...</p>}
            <p className="text-xs text-text-muted">{t("move.qr.howTo")}</p>
            {move && <p className="text-xs text-text-secondary font-mono">{t("move.noCamera", { fingerprint: move.fingerprint })}</p>}
            {move && <MoveCodeField onSubmit={(code) => { typedCode.current = code; }} />}
          </>
        )}
        {phase === "wait" && move && (
          <>
            <p className="text-sm text-text-primary">{t("move.wait", { time: waitLeft(releaseAt, t) })}</p>
            <MoveCodeField onSubmit={(code) => { typedCode.current = code; void collect(move, code); }} />
          </>
        )}
        {phase === "lock" && (
          <>
            <p className="text-sm text-text-primary">{t("move.password.ask")}</p>
            <PassphraseInput mode="set" submitLabel={t("move.password.save")} onSubmit={async (passphrase) => { lockWaiter.current?.({ passphrase }); }} />
          </>
        )}
        {phase === "password" && (
          <>
            <p className="text-sm text-text-primary">{t("move.password.reset")}</p>
            <PassphraseInput mode="set" submitLabel={t("move.password.save")} onSubmit={async (passphrase) => { passwordWaiter.current?.(passphrase); }} />
            <button onClick={() => passwordWaiter.current?.(undefined)} className="text-xs text-text-muted underline">{t("move.password.skip")}</button>
          </>
        )}
        {phase === "working" && <p className="text-sm text-text-primary">{t("move.working")}</p>}
        {phase === "done" && (
          <>
            <p className="text-sm font-medium text-text-primary">{t("move.done")}</p>
            <button onClick={() => navigate("/accounts")} className="w-full text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white">{t("move.qr.submit")}</button>
          </>
        )}
        {phase === "stopped" && <p className="text-sm text-text-primary">{t("move.stopped")}</p>}
        {(phase === "expired" || phase === "stopped") && (
          <button onClick={begin} className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary">{t("move.retry")}</button>
        )}
        {phase === "expired" && <p className="text-sm text-text-primary">{t("move.expired")}</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
        {phase === "error" && (
          <button onClick={() => (claimed.current?.lock ? finish() : begin())} className="text-xs px-3 py-1.5 rounded bg-surface-tertiary text-text-secondary">{t("move.retry")}</button>
        )}
        {phase === "error" && canSkipBackup && (
          <button onClick={() => finish(true)} className="text-xs px-3 py-1.5 rounded bg-yellow-500/10 text-yellow-500">{t("move.skipBackup")}</button>
        )}
        {phase !== "working" && phase !== "done" && (
          <div className="flex justify-center gap-3 text-xs text-text-muted">
            {hasAnyToken() && !claimed.current && <Link to="/move/restore" className="underline">{t("move.noOld")}</Link>}
            <Link to="/recovery" className="underline">{t("move.useFile")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}
