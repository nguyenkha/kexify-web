import { useEffect, useRef } from "react";
import { AuthError } from "./auth";
import { cancelPasskeyAutofill, passkeyAutofillSupported, passkeyModalActive, signInWithPasskey } from "./passkey-sign-in";

const MAX_RESTARTS = 5;
/** Server challenge TTL (api auth-passkey-login.ts, 5 min) minus a margin for Face ID + the verify call. */
const REARM_MS = 4 * 60 * 1000;

/**
 * Conditional UI: while `enabled`, passkeys for this site show up in the autofill list of
 * the input marked `autoComplete="username webauthn"`. Picking one signs in. An expired or
 * timed-out request is restarted; a modal passkey prompt takes over (disable this hook while
 * it runs, it restarts afterwards).
 */
export function usePasskeyAutofill(enabled: boolean, onSignedIn: () => void, onError: (err: unknown) => void) {
  const handlers = useRef({ onSignedIn, onError });
  useEffect(() => { handlers.current = { onSignedIn, onError }; });

  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    (async () => {
      if (!(await passkeyAutofillSupported())) return;
      for (let restarts = 0; !stop.signal.aborted && restarts <= MAX_RESTARTS;) {
        // Browsers keep a conditional request open past its timeout; the server challenge does not. Re-arm with a
        // fresh challenge before it expires, so a passkey picked from the list is never verified against a dead one.
        let rearmed = false;
        const rearm = setTimeout(() => { rearmed = true; cancelPasskeyAutofill(); }, REARM_MS);
        try {
          await signInWithPasskey({ autofill: true, signal: stop.signal });
          if (!stop.signal.aborted) handlers.current.onSignedIn();
          return;
        } catch (err) {
          if (stop.signal.aborted || passkeyModalActive()) return;
          const code = err instanceof AuthError ? err.code : null;
          if (code === "passkeyExpired" || code === "passkeyCancelled") {
            if (!rearmed) restarts++;
            continue;
          }
          // Only a refusal of a passkey the user picked is worth showing; a failed options call on page load
          // (offline, rate limit) is not, the buttons still work.
          if (code === "passkeyFailed" || code === "accountFrozen") handlers.current.onError(err);
          return;
        } finally {
          clearTimeout(rearm);
        }
      }
    })();
    return () => { stop.abort(); cancelPasskeyAutofill(); };
  }, [enabled]);
}
