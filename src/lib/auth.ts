import { apiUrl } from "./apiBase";

// Session JWT — short-lived, dies with browser tab/close
const TOKEN_KEY = "secretkey_token";

// ── Session token (sessionStorage) ──

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem("kxi:authenticated", "1");
  // Cache identity for lock screen (survives tab close)
  const payload = decodeJwtPayload(token);
  if (payload?.sub) localStorage.setItem("kxi:identity", JSON.stringify(payload));
}

/** Clear session token and auth state (refresh token is httpOnly cookie, managed by server) */
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("kxi:authenticated");
  localStorage.removeItem("kxi:identity");
}

/** Whether user has previously authenticated (persists across tabs/sessions) */
export function wasAuthenticated(): boolean {
  return localStorage.getItem("kxi:authenticated") === "1";
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Safely parse JSON from a response, returning null if not JSON */
async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Clear the session and go to sign-in. Keeps the device share (signing out is not removing the wallet).
 * `sessionEnded` shows "Your session ended. Sign in again." on the login page. */
export function signOut(opts?: { sessionEnded?: boolean }) {
  clearToken();
  window.location.href = opts?.sessionEnded ? "/login?session=ended" : "/login";
}

/** Sign-in failure kinds; the UI maps them to localised text (lib/auth-error-message.ts). */
export type AuthErrorCode =
  | "network" | "captcha" | "rateLimited" | "invalidCode" | "codeLocked"
  | "tokenInvalid" | "tokenUsed" | "tokenExpired"
  | "passkeyCancelled" | "passkeyFailed" | "passkeyExpired" | "accountFrozen" | "unknown";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, detail?: string) {
    super(detail || code);
    this.name = "AuthError";
    this.code = code;
  }
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(apiUrl(path), init);
  } catch {
    throw new AuthError("network");
  }
}

/** Map a failed auth response to a code (api/src/routes/auth.ts + middleware/rate-limit.ts). */
async function authFailure(res: Response, kind: "request" | "code" | "link"): Promise<AuthError> {
  const data = await safeJson(res);
  const text = typeof data?.error === "string" ? data.error : "";
  if (res.status === 429) {
    // verify-code: 5 wrong codes burn every code ("Use the link in the email ...")
    if (kind === "code" && /use the link/i.test(text)) return new AuthError("codeLocked", text);
    return new AuthError("rateLimited", text);
  }
  if (kind === "request" && res.status === 403) return new AuthError("captcha", text);
  if (kind === "code" && (res.status === 400 || res.status === 404)) return new AuthError("invalidCode", text);
  if (kind === "link") {
    if (/already used/i.test(text)) return new AuthError("tokenUsed", text);
    if (/expired/i.test(text)) return new AuthError("tokenExpired", text);
    if (res.status === 400 || res.status === 404) return new AuthError("tokenInvalid", text);
  }
  return new AuthError("unknown", text || `HTTP ${res.status}`);
}

async function readSessionToken(res: Response): Promise<string> {
  const data = await safeJson(res);
  if (!data?.token) throw new AuthError("unknown", "Invalid server response");
  setToken(data.token as string);
  return data.token as string;
}

export async function requestMagicLink(email: string, captchaToken?: string): Promise<void> {
  const res = await authFetch("/api/auth/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, captchaToken }),
  });
  if (!res.ok) throw await authFailure(res, "request");
}

export async function verifyToken(token: string): Promise<string> {
  const res = await authFetch(`/api/auth/verify?token=${encodeURIComponent(token)}`, { credentials: "include" });
  if (!res.ok) throw await authFailure(res, "link");
  return readSessionToken(res);
}

export async function verifyCode(email: string, code: string): Promise<string> {
  const res = await authFetch("/api/auth/verify-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
    credentials: "include",
  });
  if (!res.ok) throw await authFailure(res, "code");
  return readSessionToken(res);
}

// ── JWT helpers ──

/** Decode JWT payload (works on expired tokens too — no signature check) */
function decodeJwtPayload(token: string): { sub: string; type?: string; email?: string; exp?: number } | null {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch { return null; }
}

export function getJwtPayload(): { sub: string; type?: string; email?: string; exp?: number } | null {
  const token = getToken();
  if (token) return decodeJwtPayload(token);
  // Fallback: cached identity from localStorage (for lock screen after tab close)
  try {
    const cached = localStorage.getItem("kxi:identity");
    if (cached) return JSON.parse(cached);
  } catch { /* ignore */ }
  return null;
}

/** Seconds until the current session JWT expires (negative if expired, -1 if no token) */
export function getTokenTtl(): number {
  const token = getToken();
  if (!token) return -1;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return -1;
  return payload.exp - Math.floor(Date.now() / 1000);
}

/** Refresh the session JWT using the current valid session JWT.
 * Returns { token, ttl } on success, null on auth failure (shows lock screen). */
export async function refreshToken(): Promise<{ token: string; ttl: number } | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(apiUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return null; // Session expired — lock screen will handle
    if (!res.ok) return null;
    const data = await safeJson(res);
    if (!data?.token) return null;
    setToken(data.token as string);
    return { token: data.token as string, ttl: data.ttl as number };
  } catch {
    return null; // Network error — don't clear tokens
  }
}

export function isStandaloneJwt(): boolean {
  return getJwtPayload()?.type === "standalone";
}

/** Get the identity ID from the JWT (userId for email, keyShareId for standalone) */
export function getIdentityId(): string | null {
  return getJwtPayload()?.sub ?? null;
}

/** Check if user has a session or was previously authenticated */
export function hasAnyToken(): boolean {
  return !!getToken() || wasAuthenticated();
}

export interface MeUser {
  id: string;
  email: string;
  frozenAt: string | null;
  unfreezeAt: string | null;
}

export interface MeStandalone {
  keyShareId: string;
  type: "standalone";
}

export async function getMe(): Promise<MeUser | null> {
  const token = getToken();
  if (!token) return null;

  // Standalone users don't have a user record — return null for MeUser
  if (isStandaloneJwt()) return null;

  try {
    const res = await fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await safeJson(res);
    return (data?.user as MeUser) ?? null;
  } catch {
    // Network error (server unreachable) — don't clear token
    return null;
  }
}
