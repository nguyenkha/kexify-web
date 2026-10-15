import { useState, useEffect, useRef, useCallback } from "react";
import { useIdleLock } from "../context/IdleLockContext";
import { fetchUnlockChallenge, completePasskeyUnlock, type UnlockChallenge } from "../lib/passkey";
import { setToken, signOut, getMe } from "../lib/auth";
import { mapCommonError } from "../lib/error-message";
import { useTranslation } from "react-i18next";

const MAX_FAILURES = 3;
const CHALLENGE_MAX_AGE_MS = 4 * 60 * 1000; // server TTL = 5 min

/** Event fired after an in-place unlock so the shell can refresh server data. */
export const SESSION_RESTORED_EVENT = "kxi:session-restored";

export function LockScreen() {
  const { locked, ownerId, coldStart, unlock } = useIdleLock();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  /** Why no unlock challenge could be fetched (offline, no usable passkey on this site). */
  const [blocked, setBlocked] = useState("");
  const [failures, setFailures] = useState(0);
  const [email, setEmail] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const challengeRef = useRef<UnlockChallenge | null>(null);
  const challengeFetchedAt = useRef<number>(0);

  const prefetchChallenge = useCallback(async () => {
    if (!ownerId) return;
    setFetching(true);
    try {
      challengeRef.current = await fetchUnlockChallenge(ownerId);
      challengeFetchedAt.current = Date.now();
      setBlocked("");
    } catch (err) {
      challengeRef.current = null;
      // Offline -> network reason; "No passkeys registered" (none on this domain, or still
      // in the 24 h probation) or any other refusal -> cannot unlock here.
      const network = mapCommonError(err, t) === t("auth.error.network") || !navigator.onLine;
      setBlocked(network ? t("auth.error.network") : t("lock.cannotUnlock"));
    } finally {
      setFetching(false);
    }
  }, [ownerId, t]);

  // Reset state, fetch email, and pre-fetch challenge on lock
  useEffect(() => {
    if (locked && ownerId) {
      setError("");
      setFailures(0);
      setLoading(false);
      prefetchChallenge();
      getMe().then((me) => setEmail(me?.email ?? "")).catch(() => {});
    }
  }, [locked, ownerId, prefetchChallenge]);

  // Re-fetch challenge every 4 minutes to prevent expiry
  useEffect(() => {
    if (!locked || !ownerId) return;
    const iv = setInterval(prefetchChallenge, CHALLENGE_MAX_AGE_MS);
    return () => clearInterval(iv);
  }, [locked, ownerId, prefetchChallenge]);

  // Focus trap
  useEffect(() => {
    if (locked) buttonRef.current?.focus();
  }, [locked, loading]);

  // All hooks above — safe to return early now
  if (!locked) return null;

  // No identity to unlock with: same dead-end as a missing passkey
  const reason = !ownerId ? t("lock.cannotUnlock") : blocked;

  async function handleUnlock() {
    if (!ownerId) return;

    // No fresh challenge: fetch now; the passkey prompt needs the next click (user gesture)
    const challengeAge = Date.now() - challengeFetchedAt.current;
    if (!challengeRef.current || challengeAge > CHALLENGE_MAX_AGE_MS) {
      await prefetchChallenge();
      return;
    }

    setLoading(true);
    setError("");
    try {
      const challenge = challengeRef.current!;
      challengeRef.current = null;

      const result = await completePasskeyUnlock(challenge);
      setToken(result.token);
      localStorage.setItem("idleLock.hasPasskeys", "true");
      if (coldStart) {
        // Locked since page load: screens loaded without a session, reload them
        window.location.reload();
        return;
      }
      // Session expired mid-use: keep the current screen and its state
      unlock();
      window.dispatchEvent(new Event(SESSION_RESTORED_EVENT));
    } catch (err: unknown) {
      // Cancelled prompt: no error text, but it still counts toward the sign-out hint
      const cancelled = err instanceof Error && err.name === "NotAllowedError";
      setError(cancelled ? "" : t("idleLock.failed"));
      setFailures((f) => f + 1);
      prefetchChallenge();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={t("idleLock.title")}
    >
      <div className="flex flex-col items-center gap-4 max-w-sm px-6 text-center">
        {/* Lock icon */}
        <svg className="w-12 h-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>

        <h2 className="text-lg font-semibold text-white">{t("idleLock.title")}</h2>
        <p className="text-sm text-text-muted">{t("idleLock.description")}</p>
        {email && <p className="text-xs text-text-tertiary">{email}</p>}

        {/* Unlock button */}
        <button
          ref={buttonRef}
          onClick={handleUnlock}
          disabled={loading || fetching || !ownerId}
          className="w-full mt-2 px-4 py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading || fetching ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              {loading ? t("idleLock.unlocking") : t("common.loading")}
            </span>
          ) : (
            t("idleLock.unlock")
          )}
        </button>

        {/* Error message */}
        {error && !reason && <p role="alert" className="text-xs text-red-400">{error}</p>}

        {/* Cannot unlock here (offline / no usable passkey): say why and offer Sign out at once */}
        {reason && (
          <div className="mt-2" role="alert">
            <p className="text-xs text-red-400 mb-2">{reason}</p>
            <button
              onClick={() => signOut()}
              className="text-xs text-red-400 hover:text-red-300 underline transition-colors"
            >
              {t("idleLock.signOut")}
            </button>
          </div>
        )}

        {/* Sign out escape hatch after 3 failures */}
        {!reason && failures >= MAX_FAILURES && (
          <div className="mt-2">
            <p className="text-xs text-text-muted mb-2">{t("idleLock.signOutHint")}</p>
            <button
              onClick={() => signOut()}
              className="text-xs text-red-400 hover:text-red-300 underline transition-colors"
            >
              {t("idleLock.signOut")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
