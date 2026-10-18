// Workspace-scoped access tokens. Wallet routes (/keys/:id, /sign, /chain, /address-book, eddsa keygen) need a token
// whose `ws` claim is the wallet (key share id). The account token (no `ws`) is exchanged via POST /api/auth/workspace
// and cached in memory per workspace. Standalone sessions already hold a token with `ws` = their key share.
import { apiUrl } from "./apiBase";
import { decodeJwtPayload, getToken } from "./auth";

/** Refresh the workspace token when it has less than this left. */
const MIN_TTL_SECONDS = 120;

interface Entry { token: string; exp: number }

/** The server does not know this workspace for the login (deleted or not owned): POST /auth/workspace answered 404. */
export class WorkspaceNotFoundError extends Error {
  readonly workspaceId: string;
  constructor(workspaceId: string) { super(`workspace ${workspaceId} not found`); this.name = "WorkspaceNotFoundError"; this.workspaceId = workspaceId; }
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
let cacheIdentity: string | null = null;

/** Drop every cached workspace token. With `keepIdentity` (`sub:sid`), only when the login differs from the cached one. */
export function clearWorkspaceTokens(keepIdentity?: string): void {
  if (keepIdentity !== undefined && keepIdentity === cacheIdentity) return;
  cache.clear();
  inflight.clear();
  cacheIdentity = keepIdentity ?? null;
}

function fresh(e: Entry | undefined): e is Entry {
  return !!e && e.exp - Date.now() / 1000 > MIN_TTL_SECONDS;
}

async function fetchWorkspaceToken(ws: string, accountToken: string, identity: string): Promise<string | null> {
  try {
    const res = await fetch(apiUrl("/api/auth/workspace"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accountToken}` },
      body: JSON.stringify({ workspaceId: ws }),
    });
    if (res.status === 404 || res.status === 403) throw new WorkspaceNotFoundError(ws); // not this account's wallet
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as { token?: string } | null;
    const token = data?.token;
    const exp = token ? decodeJwtPayload(token)?.exp : undefined;
    if (!token || !exp) return null;
    // A sign-out / sign-in while the request was in flight: this token belongs to the old login.
    if (cacheIdentity !== identity) return null;
    cache.set(ws, { token, exp });
    return token;
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) throw err;
    return null;
  }
}

/** A token for workspace `ws`: cached, re-fetched when absent or near expiry. Standalone tokens pass through.
 *  If the exchange fails the account token is used, so a server in its compatibility window still answers. */
export async function workspaceToken(ws: string, opts?: { strict?: boolean }): Promise<string | null> {
  const account = getToken();
  if (!account) return null;
  const p = decodeJwtPayload(account);
  if (p?.ws && p.ws === ws) return account; // standalone: the session token is the workspace token
  if (p?.ws && opts?.strict) throw new WorkspaceNotFoundError(ws); // a standalone session owns no other wallet
  const identity = `${p?.sub ?? ""}:${p?.sid ?? ""}`;
  if (cacheIdentity !== identity) clearWorkspaceTokens(identity);

  const hit = cache.get(ws);
  if (fresh(hit)) return hit.token;
  let pending = inflight.get(ws);
  if (!pending) {
    const mine: Promise<string | null> = fetchWorkspaceToken(ws, account, identity).finally(() => {
      if (inflight.get(ws) === mine) inflight.delete(ws);
    });
    pending = mine;
    inflight.set(ws, pending);
  }
  // Compat window: an unscoped account token still reaches owned wallets. A ws-scoped token never stands in for another workspace.
  const fallback = p?.ws ? null : account;
  try {
    const t = await pending;
    if (cacheIdentity !== identity) return null; // signed out / switched while waiting
    return t ?? fallback;
  } catch (err) {
    // Not found: strict callers re-pick the workspace; others use the fallback.
    if (err instanceof WorkspaceNotFoundError && opts?.strict) throw err;
    return cacheIdentity === identity ? fallback : null;
  }
}

/** `Authorization` header for workspace `ws` (empty when signed out). */
export async function workspaceHeaders(ws: string): Promise<Record<string, string>> {
  const token = await workspaceToken(ws);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
