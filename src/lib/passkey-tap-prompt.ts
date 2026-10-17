// Fallback for a passkey prompt that the browser refused for lack of a user gesture.
//
// A signing assertion is bound to the transaction's digests, so it can only start after
// the transaction is built — sometimes seconds after the user's click. Browsers that
// require transient user activation for WebAuthn (Safari) then reject it with
// NotAllowedError. In that case the request is handed to <PasskeyTapHost>, which shows
// a Confirm button and runs the same ceremony from that click. Still one passkey tap.

import { authenticatePasskey, type PasskeyAction, type PasskeyAuthResult } from "./passkey";

export interface PasskeyTapRequest {
  withPrf: boolean;
  action: PasskeyAction;
  resolve: (r: PasskeyAuthResult) => void;
  reject: (e: Error) => void;
}

let listener: ((req: PasskeyTapRequest) => void) | null = null;
/** The request on screen; a newer one replaces it, so it is rejected (never left hanging). */
let current: PasskeyTapRequest | null = null;

export function subscribePasskeyTap(fn: (req: PasskeyTapRequest) => void): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

/**
 * True when WebAuthn may have refused because the page had no user activation left.
 * Without navigator.userActivation (Safari < 16.4) a missing gesture and a cancel are the
 * same NotAllowedError, so both get the Confirm button: a user who cancelled cancels it too.
 */
export function lackedUserActivation(err: unknown): boolean {
  const e = err as { name?: string; cause?: { name?: string } } | null;
  const notAllowed = e?.name === "NotAllowedError" || e?.cause?.name === "NotAllowedError";
  if (!notAllowed) return false;
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return activation ? !activation.isActive : true;
}

export function requestPasskeyTap(withPrf: boolean, action: PasskeyAction): Promise<PasskeyAuthResult> {
  const notify = listener;
  if (!notify) return Promise.reject(new Error("passkey_auth_required"));
  current?.reject(new Error("passkey_auth_required"));
  return new Promise((resolve, reject) => {
    const req: PasskeyTapRequest = {
      withPrf, action,
      resolve: (r) => { if (current === req) current = null; resolve(r); },
      reject: (e) => { if (current === req) current = null; reject(e); },
    };
    current = req;
    notify(req);
  });
}

/**
 * authenticatePasskey for a prompt that may start well after the click (a built transaction,
 * a generated export key): if the browser refuses it for lack of user activation, ask for a
 * tap on the Confirm button and run the same ceremony from there.
 */
export async function authenticateWithTapFallback(opts: { withPrf?: boolean; action: PasskeyAction }): Promise<PasskeyAuthResult> {
  try {
    return await authenticatePasskey(opts);
  } catch (err) {
    if (!lackedUserActivation(err)) throw err;
    return requestPasskeyTap(!!opts.withPrf, opts.action);
  }
}
