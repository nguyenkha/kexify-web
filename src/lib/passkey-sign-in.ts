// Sign in with a passkey (no email typed): a discoverable-credential assertion against
// /auth/passkey/*, which returns the same session as an email login.
//
// The session unlocks nothing by itself: the browser share is still decrypted with the
// passkey's PRF at sign time, and every sensitive action asks for its own assertion.

import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, WebAuthnAbortService } from "@simplewebauthn/browser";
import { apiUrl } from "./apiBase";
import { AuthError, setToken } from "./auth";
import { b64 } from "./device-move/move-codec";
import { noteEscrowPasskey } from "./passkey-escrow-key";
import { loginAssertionWithEscrowKey } from "./passkey-login-assertion";

type GetAssertion = typeof startAuthentication;

export function passkeySignInSupported(): boolean {
  return browserSupportsWebAuthn();
}

export function passkeyAutofillSupported(): Promise<boolean> {
  return browserSupportsWebAuthnAutofill().catch(() => false);
}

// The WebAuthn ceremony in flight. Starting one aborts the other (simplewebauthn keeps one
// abort signal), so a cancel must only ever hit an autofill request, never a modal prompt.
let ceremony: "autofill" | "modal" | null = null;

/** Cancel a pending autofill (conditional) request, e.g. when the login page unmounts. */
export function cancelPasskeyAutofill() {
  if (ceremony === "autofill") WebAuthnAbortService.cancelCeremony();
}

export function passkeyModalActive(): boolean {
  return ceremony === "modal";
}

async function post(path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include", // httpOnly refresh-token cookie
    });
  } catch {
    throw new AuthError("network");
  }
}

async function failure(res: Response): Promise<AuthError> {
  const data = await res.json().catch(() => null) as { error?: string; code?: string } | null;
  if (res.status === 429) return new AuthError("rateLimited", data?.error);
  if (res.status === 403 && data?.code === "account_frozen") return new AuthError("accountFrozen", data.error);
  if (/expired challenge/i.test(data?.error ?? "")) return new AuthError("passkeyExpired", data?.error);
  if (res.status === 400) return new AuthError("passkeyFailed", data?.error);
  return new AuthError("unknown", data?.error || `HTTP ${res.status}`);
}

/**
 * One passkey sign-in. `autofill` starts a conditional request that resolves when the user
 * picks a passkey from the email field's autofill list (it waits until then, or until
 * another ceremony cancels it). Stores the session token and returns it.
 */
export async function signInWithPasskey(opts: { autofill?: boolean; signal?: AbortSignal; getAssertion?: GetAssertion } = {}): Promise<string> {
  const optRes = await post("/api/auth/passkey/options");
  if (!optRes.ok) throw await failure(optRes);
  const { options, challengeId } = await optRes.json();
  // An autofill request must never start over a modal prompt (it would abort it), nor after
  // its page stopped wanting it while the options were in flight.
  if (opts.autofill && (ceremony === "modal" || opts.signal?.aborted)) throw new AuthError("passkeyCancelled");

  const mine = opts.autofill ? "autofill" : "modal";
  ceremony = mine;
  let credential;
  let escrowPublic: Uint8Array | undefined;
  try {
    // Default: our own assertion with the escrow PRF salt (the passkey's escrow key goes with the verify call).
    if (opts.getAssertion) credential = await opts.getAssertion({ optionsJSON: options, useBrowserAutofill: !!opts.autofill });
    else ({ credential, escrowPublic } = await loginAssertionWithEscrowKey(options, !!opts.autofill));
  } catch (err) {
    // Dismissed prompt, timeout, or cancelled by another ceremony: not an error to show.
    const name = (err as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "AbortError") throw new AuthError("passkeyCancelled");
    throw err;
  } finally {
    if (ceremony === mine) ceremony = null;
  }

  const res = await post("/api/auth/passkey/verify", { challengeId, credential, ...(escrowPublic ? { escrowKey: b64(escrowPublic) } : {}) });
  if (!res.ok) throw await failure(res);
  if (escrowPublic) noteEscrowPasskey(credential.id, escrowPublic);
  const data = await res.json().catch(() => null) as { token?: string } | null;
  if (!data?.token) throw new AuthError("unknown", "Invalid server response");
  // Stopped while verifying (the page moved on, or another sign-in started): this session must not
  // overwrite a newer one. The server session is simply never used.
  if (opts.signal?.aborted || (opts.autofill && ceremony === "modal")) throw new AuthError("passkeyCancelled");
  setToken(data.token);
  return data.token;
}
