import { startRegistration, startAuthentication, base64URLStringToBuffer } from "@simplewebauthn/browser";
import { authHeaders } from "./auth";
import { workspaceHeaders } from "./workspace-token";
import { apiUrl } from "./apiBase";
import { splitAssertion } from "./webauthn-assertion-json";

// ── Action-bound passkey tickets (audit F15) ────────────────────
//
// Every sensitive request needs its own passkey assertion. The assertion's challenge is
// bound by the server to exactly one action (and its key / digests / rules), and the
// ticket it returns works once, for that request only. Nothing is cached between actions.

export type PasskeyActionName =
  | "sign" | "generate" | "eddsa-init" | "policy.set" | "policy.cancel" | "backup.upload"
  | "export.hkdf" | "export.request" | "export.request-cancel" | "export.share" | "export.pve"
  | "unfreeze" | "unfreeze.cancel" | "passkey.register" | "passkey.delete"
  | "session.revoke" | "session.revoke-others";

export interface PasskeyAction {
  action: PasskeyActionName;
  keyShareId?: string;
  /** sign: sha256 hex of each base64 `data` sent to /sign/init, in order (a UTXO batch as a whole). */
  digests?: string[];
  /** policy.set: see rulesSha256(). */
  rulesSha256?: string;
  /** passkey.delete */
  passkeyId?: string;
  /** session.revoke */
  sessionId?: string;
  /** export.share / export.pve: sha256 hex of the base64 ephemeral or PVE key sent in the body. */
  ekSha256?: string;
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hex sha256 of the rules list as sent in `{ rules }` (the server hashes the same JSON). */
export function rulesSha256(rules: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(rules));
}

export function passkeyHeader(ticket: string | undefined): Record<string, string> {
  return ticket ? { "x-passkey-token": ticket } : {};
}

/** Headers for sensitive endpoints: JSON + auth, plus the action's ticket when given. */
export function sensitiveHeaders(ticket?: string): Record<string, string> {
  return { "Content-Type": "application/json", ...authHeaders(), ...passkeyHeader(ticket) };
}

/** Same as sensitiveHeaders, with the token of workspace (key share) `ws` — for wallet routes. */
export async function sensitiveHeadersFor(ws: string, ticket?: string): Promise<Record<string, string>> {
  return { "Content-Type": "application/json", ...(await workspaceHeaders(ws)), ...passkeyHeader(ticket) };
}

/** One passkey tap, then the request with its ticket. */
export async function fetchWithPasskey(url: string, init: RequestInit, action: PasskeyAction): Promise<Response> {
  const { token } = await authenticatePasskey({ action });
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...passkeyHeader(token) } });
}

// ── API types ───────────────────────────────────────────────────

export interface PasskeyInfo {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** Set while the passkey is in probation: it cannot be used before this time. */
  activeAt?: string | null;
  /** Pending passkey from the other domain, listed here only so it can be removed. */
  otherSite?: boolean;
}

/** Registered, but in probation — the server will not accept it until `activeAt`. */
export class PasskeyPendingError extends Error {
  readonly passkey: PasskeyInfo & { activeAt: string };
  constructor(passkey: PasskeyInfo & { activeAt: string }) {
    super(`Passkey becomes active on ${new Date(passkey.activeAt).toLocaleString()}`);
    this.name = "PasskeyPendingError";
    this.passkey = passkey;
  }
}

export function isPasskeyPending(p: PasskeyInfo): p is PasskeyInfo & { activeAt: string } {
  return !!p.activeAt && new Date(p.activeAt).getTime() > Date.now();
}

// ── API calls ───────────────────────────────────────────────────

/**
 * Passkeys usable on this domain. Pass includePending to also get passkeys still in
 * probation (from this or the other domain) — only for listing and managing them.
 */
export async function fetchPasskeys(opts?: { includePending?: boolean; strict?: boolean }): Promise<PasskeyInfo[]> {
  const res = await fetch(apiUrl("/api/passkeys"), {
    headers: authHeaders(),
  });
  // strict: an error must not read as "no passkeys" (callers that branch on it).
  if (opts?.strict && !res.ok) throw new Error(`passkeys ${res.status}`);
  const data = await res.json();
  const list: PasskeyInfo[] = data.passkeys ?? [];
  return opts?.includePending ? list : list.filter((p) => !isPasskeyPending(p));
}

export async function registerPasskey(name?: string): Promise<PasskeyInfo> {
  // Only pending passkeys so far: another one would just wait out its own probation
  // (and send another email), so report the date of the one already waiting.
  const current = await fetchPasskeys({ includePending: true });
  const pending = current.find(isPasskeyPending);
  if (pending && current.every(isPasskeyPending)) throw new PasskeyPendingError(pending);

  // 1. Get registration options; with an active passkey the server asks for a step-up tap.
  const optInit = { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() } };
  let ticket: string | undefined;
  let optRes = await fetch(apiUrl("/api/passkeys/register-options"), optInit);
  if (optRes.status === 401 && (await optRes.clone().json().catch(() => ({})))?.error === "passkey_auth_required") {
    ticket = (await authenticatePasskey({ action: { action: "passkey.register" } })).token;
    optRes = await fetch(apiUrl("/api/passkeys/register-options"), { ...optInit, headers: { ...optInit.headers, ...passkeyHeader(ticket) } });
  }
  const optData = await optRes.json();
  if (!optRes.ok) throw new Error(optData?.message || optData?.error || "Could not start passkey registration");
  const { options, challengeId } = optData;

  // 2. Trigger browser WebAuthn prompt
  const credential = await startRegistration({ optionsJSON: options });

  // 3. Send credential to server
  // The current API records the step-up on the challenge; an older one re-checks the token.
  const regRes = await fetch(apiUrl("/api/passkeys/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...passkeyHeader(ticket) },
    body: JSON.stringify({ challengeId, credential, name }),
  });
  const data = await regRes.json();
  if (data.error) throw new Error(data.message || data.error);
  const info = data as PasskeyInfo;
  // Without an existing passkey to vouch for it, a new one waits out a probation period.
  if (isPasskeyPending(info)) throw new PasskeyPendingError(info);
  // Cache that user now has passkeys (for idle lock on next session)
  localStorage.setItem("idleLock.hasPasskeys", "true");
  return info;
}

/**
 * Passkey auth for saving an imported key share. A user arriving on a new domain has
 * no passkey there yet (passkeys are bound to the domain), so register one first
 * instead of failing with "No passkeys registered".
 */
export async function authenticatePasskeyForImport(): Promise<PasskeyAuthResult> {
  // registerPasskey reports a passkey still in probation instead of adding another.
  if ((await fetchPasskeys()).length === 0) await registerPasskey();
  return authenticatePasskey({ withPrf: true });
}

// Fixed salt for PRF-based key share encryption
const PRF_SALT = new TextEncoder().encode("secretkey-keyshare-encryption");

export interface PasskeyAuthResult {
  /** Single-use ticket for `action`; absent for a verify-only (PRF read) assertion. */
  token?: string;
  prfKey?: CryptoKey;
  credentialId?: string;
}

/**
 * One passkey ceremony. With `action`, the challenge is bound to that action and the
 * result carries its single-use ticket; with `withPrf`, the same assertion also returns
 * the PRF key, so unlocking the browser share and authorizing the action take one tap.
 */
export async function authenticatePasskey(opts?: { withPrf?: boolean; action?: PasskeyAction }): Promise<PasskeyAuthResult> {
  // 1. Get authentication options (challenge bound to the action)
  const optRes = await fetch(apiUrl("/api/passkeys/authenticate-options"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(opts?.action ?? { action: "local" }),
  });
  // Surface the server's reason instead of destructuring an error body. Credentials are
  // scoped to the RP that issued them, so an account with passkeys on one domain has
  // none on another until it registers there — a normal state that must read as one.
  if (!optRes.ok) {
    const data = await optRes.json().catch(() => ({}));
    // The only passkey is still in its cooling period: say when it activates instead of a generic failure.
    if (data?.code === "passkey_pending" && typeof data.activeAt === "string") {
      throw new PasskeyPendingError({ id: "", name: null, createdAt: "", lastUsedAt: null, activeAt: data.activeAt });
    }
    throw new Error((data?.error as string) || "Could not start passkey authentication");
  }
  const { options, challengeId } = await optRes.json();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let credential: any;
  let prfOutput: BufferSource | undefined;

  if (opts?.withPrf) {
    // Bypass @simplewebauthn/browser's startAuthentication — it doesn't pass
    // extensions through to navigator.credentials.get(), so PRF never reaches
    // the authenticator. We call the WebAuthn API directly and convert the
    // result to the JSON format the server expects.
    const allowCredentials = options.allowCredentials?.map((c: { id: string; type: string; transports?: string[] }) => ({
      id: base64URLStringToBuffer(c.id),
      type: c.type,
      ...(c.transports ? { transports: c.transports } : {}),
    }));

    const publicKey: PublicKeyCredentialRequestOptions = {
      challenge: base64URLStringToBuffer(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification as UserVerificationRequirement,
      allowCredentials,
      extensions: {
        prf: { eval: { first: PRF_SALT } },
      } as AuthenticationExtensionsClientInputs,
    };

    let rawCredential: PublicKeyCredential;
    try {
      rawCredential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
    } catch (prfErr) {
      // Some passkey providers (e.g. 1Password) may fail with PRF extension.
      // Retry without PRF — auth still works, just no encryption key (a second prompt;
      // a share that needs PRF then cannot be unlocked by this provider).
      console.warn("[passkey] PRF request failed, retrying without PRF:", prfErr);
      delete publicKey.extensions;
      rawCredential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
    }
    if (!rawCredential) throw new Error("Authentication was not completed");
    // The PRF output stays in a local: it never goes into the serialized credential.
    ({ credential, prfOutput } = splitAssertion(rawCredential));
  } else {
    credential = await startAuthentication({ optionsJSON: options });
  }

  // 3. Verify with server
  const authRes = await fetch(apiUrl("/api/passkeys/authenticate"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ challengeId, credential }),
  });
  const data = await authRes.json();
  if (data.error) throw new Error(data.error);

  // 5. Derive AES-256-GCM key from PRF output if available
  let prfKey: CryptoKey | undefined;
  if (prfOutput) {
    const rawKey = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
    prfKey = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: PRF_SALT, info: new Uint8Array(0) },
      rawKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  return { token: data.passkeyToken, prfKey, credentialId: credential.id };
}

/**
 * Local-only PRF authentication — no server calls needed.
 * Used for standalone unlock on the login page (no JWT available).
 * Returns the PRF-derived CryptoKey for decrypting the stored share.
 */
export async function localPrfAuthenticate(credentialId: string): Promise<CryptoKey> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId: window.location.hostname,
    timeout: 60000,
    userVerification: "preferred",
    allowCredentials: [{
      id: base64URLStringToBuffer(credentialId),
      type: "public-key",
    }],
    extensions: {
      prf: { eval: { first: PRF_SALT } },
    } as AuthenticationExtensionsClientInputs,
  };

  const rawCredential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
  if (!rawCredential) throw new Error("Authentication was not completed");

  const extResults = rawCredential.getClientExtensionResults();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prfResult = (extResults as any)?.prf?.results?.first;
  if (!prfResult) throw new Error("PRF not supported by this passkey");

  const rawKey = await crypto.subtle.importKey("raw", prfResult, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: PRF_SALT, info: new Uint8Array(0) },
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Pre-fetched unlock challenge (fetched on lock screen mount, used on button click) */
export interface UnlockChallenge {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any;
  challengeId: string;
}

/** Pre-fetch passkey challenge options so the WebAuthn prompt fires immediately on click.
 * iOS dismisses the prompt if there's too much async delay after the user gesture. */
export async function fetchUnlockChallenge(ownerId: string): Promise<UnlockChallenge> {
  const optRes = await fetch(apiUrl("/api/auth/passkey-unlock-options"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerId }),
  });
  if (!optRes.ok) {
    const err = await optRes.json();
    throw new Error(err.error || "Failed to get unlock options");
  }
  return optRes.json();
}

/** Complete passkey unlock using a pre-fetched challenge.
 * Call this directly in the click handler so WebAuthn prompt fires immediately. */
export async function completePasskeyUnlock(challenge: UnlockChallenge): Promise<{ token: string; ttl: number }> {
  // 1. Trigger browser WebAuthn prompt (must happen close to user gesture)
  const credential = await startAuthentication({ optionsJSON: challenge.options });

  // 2. Verify with server (credentials: include for httpOnly refresh token cookie)
  const verifyRes = await fetch(apiUrl("/api/auth/passkey-unlock-verify"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.challengeId, credential }),
    credentials: "include",
  });
  if (!verifyRes.ok) {
    const err = await verifyRes.json();
    throw new Error(err.error || "Unlock verification failed");
  }
  const data = await verifyRes.json();
  // Unlock restores the session only; each sensitive action asks for its own assertion.
  return { token: data.token, ttl: data.ttl };
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/passkeys/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}

export async function deletePasskey(id: string): Promise<void> {
  const res = await fetchWithPasskey(apiUrl(`/api/passkeys/${id}`), {
    method: "DELETE",
    headers: authHeaders(),
  }, { action: "passkey.delete", passkeyId: id });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}
