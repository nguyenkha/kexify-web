// This tab's open MPC sign session. It is cancelled (POST /api/sign/cancel) when the sign fails, when the
// page goes away mid-sign, and when the next /sign/init answers 409 "Another operation is in progress"
// because of it (the init is then retried once). The server then frees the account at once instead of
// after its 30 s idle limit. The server only lets the caller cancel its own sessions.
import { apiUrl } from "./apiBase";

/** `live`: its sign is still running here (only that sign's own failure, or the page going away, ends it). */
let open: { sessionId: string; headers: Record<string, string>; live: boolean } | null = null;
/** A cancel already on its way (after a failed sign): a 409 right after waits for it instead of giving up. */
let inflight: Promise<boolean> | null = null;

/** /sign/init returned this session. `headers` = the caller's auth headers (the passkey ticket is single-use: dropped). */
export function signSessionStarted(sessionId: string, headers: Record<string, string>): void {
  const auth = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "x-passkey-token"));
  open = { sessionId, headers: auth, live: true };
}

/** The tracked session's id: a sign compares it before and after its run to know whether it started one. */
export function openSignSessionId(): string | null {
  return open?.sessionId ?? null;
}

/** The sign completed: nothing to cancel. */
export function signSessionFinished(sessionId: string): void {
  if (open?.sessionId === sessionId) open = null;
}

/** Cancels the open session, if any. True when one was cancelled (or had already ended). Never throws.
 *  A cancel that failed on the network or a 5xx keeps the session, so the next 409 tries again. */
export async function cancelOpenSignSession(keepalive = false): Promise<boolean> {
  const s = open;
  if (!s) return inflight ?? false;
  open = null;
  const run = (async () => {
    try {
      const res = await fetch(apiUrl("/api/sign/cancel"), {
        method: "POST",
        keepalive, // still sent while the page unloads
        headers: { "Content-Type": "application/json", ...s.headers },
        body: JSON.stringify({ sessionId: s.sessionId }),
      });
      // 4xx: unknown / not ours / logged out: retrying cannot help, so it is not kept.
      if (res.status < 500) return res.ok;
    } catch { /* network: kept below */ }
    open ??= { ...s, live: false };
    return false;
  })();
  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { void cancelOpenSignSession(true); });
}

/** For a 409 SESSION_ACTIVE at init: cancels our open session only when it is stale (its sign is no longer
 *  running here). A sign still running in this tab, e.g. a send while a WalletConnect request arrives, is kept. */
export function cancelStaleSignSession(): Promise<boolean> {
  return open?.live ? Promise.resolve(false) : cancelOpenSignSession();
}
