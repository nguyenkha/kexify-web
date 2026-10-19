// Security alerts (phase 3): the in-app feed, the anonymous wallet's optional alert email, and the public
// link actions that alert emails carry (POSTed from a page with a button; a mail scanner's GET never acts).
import { apiUrl } from "./apiBase";
import { authHeaders } from "./auth";
import { workspaceHeaders } from "./workspace-token";
import { authenticatePasskey, passkeyHeader, sha256Hex } from "./passkey";
import { alertEmailMessage, getSignerRecord } from "./device-signer-key";
import { deviceAuth, SignerApiError } from "./signer-api";
import { handleSessionEnded } from "./session-ended";

export interface SecurityAlert {
  id: string;
  kind: string;
  keyShareId: string | null;
  meta: { label?: string | null; platform?: string | null; country?: string | null; signerId?: string; activeFrom?: string | null; walletName?: string | null; passkeyName?: string | null };
  createdAt: string;
  readAt: string | null;
}

/** Fired after alerts are marked read, so the shell badge refreshes. */
export const ALERTS_CHANGED_EVENT = "kx-alerts-changed";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleSessionEnded(res.status, data?.code);
    throw new SignerApiError(res.status, String(data?.code ?? data?.error ?? res.status));
  }
  return data as T;
}

export async function listAlerts(): Promise<{ alerts: SecurityAlert[]; unread: number }> {
  return json(await fetch(apiUrl("/api/alerts"), { headers: authHeaders() }));
}

/** Mark the given alerts read (all when `ids` is omitted). */
export async function markAlertsRead(ids?: string[]): Promise<void> {
  await json(await fetch(apiUrl("/api/alerts/read"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(ids ? { ids } : {}),
  }));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
}

export const normalizeAlertEmail = (email: string) => email.trim().toLowerCase();

/**
 * Set (or remove with "") the anonymous wallet's alert email. Authorised by this device's signer key when it is the
 * active signer, else by a passkey bound to the address hash. Returns `pending` when a confirm link was emailed.
 */
export async function setAlertEmail(keyShareId: string, email: string): Promise<{ pending: boolean }> {
  const normalized = normalizeAlertEmail(email);
  const emailSha256 = await sha256Hex(normalized);
  const put = async (extra: Record<string, string>, ticket: Record<string, string>) =>
    json<{ pending?: boolean }>(await fetch(apiUrl(`/api/keys/${encodeURIComponent(keyShareId)}/alert-email`), {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await workspaceHeaders(keyShareId)), ...ticket },
      body: JSON.stringify({ email: normalized || null, ...extra }),
    }));
  // This device's key when it signs for the wallet; a passkey only without one, or when the server refuses it (403).
  const rec = await getSignerRecord(keyShareId);
  const auth = rec?.signerId && rec.status === "active"
    ? await deviceAuth(keyShareId, (n) => alertEmailMessage(keyShareId, normalized ? emailSha256 : "none", n))
    : null;
  if (auth) {
    try {
      return { pending: !!(await put(auth, {})).pending };
    } catch (err) {
      // Stale local state (this device no longer signs): fall back to a passkey.
      if (!(err instanceof SignerApiError) || err.status !== 403) throw err;
    }
  }
  const { token } = await authenticatePasskey({ action: { action: "alert-email.set", keyShareId, emailSha256 } });
  return { pending: !!(await put({}, passkeyHeader(token))).pending };
}

async function publicPost<T>(path: string, token: string): Promise<{ status: number; data: T & { code?: string } }> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export type DeclineLinkResult = "stopped" | "stoppedFrozen" | "alreadyActive" | "alreadyStopped" | "expired" | "failed";

/** "No, stop it" from an email link. */
export async function declineByEmailLink(token: string): Promise<DeclineLinkResult> {
  try {
    const { status, data } = await publicPost<{ ok?: boolean; frozen?: boolean }>("/api/auth/signer-decline", token);
    if (status === 200 && data.ok) return data.frozen ? "stoppedFrozen" : "stopped";
    if (status === 409) return data.code === "ALREADY_ACTIVE" ? "alreadyActive" : "alreadyStopped";
    if (status === 400) return "expired";
    return "failed";
  } catch {
    return "failed";
  }
}

export type ConfirmEmailResult = "confirmed" | "expired" | "failed";

/** Confirm the alert email from its link. */
export async function confirmAlertEmail(token: string): Promise<ConfirmEmailResult> {
  try {
    const { status, data } = await publicPost<{ ok?: boolean }>("/api/auth/alert-email/confirm", token);
    if (status === 200 && data.ok) return "confirmed";
    return status === 400 || status === 404 ? "expired" : "failed";
  } catch {
    return "failed";
  }
}
