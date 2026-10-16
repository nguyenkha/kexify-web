/**
 * Client version gate (docs/mpc-protocol-versions.md, api/src/client-version.ts).
 *
 * Every API request carries `X-Kexify-Client: web/<version> (build <sha7>); mpc=2p:1`. When the API
 * answers 426 `{error:"update_required"}` this tab is older than the server accepts: listeners show the
 * "new version available" screen and the page reloads into the current build. A stale tab whose lazy
 * chunk no longer exists after a deploy (`vite:preloadError`) is the same situation and takes the same path.
 */

import { API_BASE } from "./apiBase";

export const CLIENT_HEADER = "X-Kexify-Client";
/** MPC protocols this build speaks (cb-mpc 0.3.0–0.6.x ECDSA-2P/EdDSA-2P). */
export const CLIENT_MPC_PROTOCOLS = ["2p:1"];

export interface UpdateRequired {
  platform: string;
  minSupported: string;
  /** The API refused this build (426): reload automatically. A missing chunk only offers the reload button —
   *  it may be a flaky network, and an automatic reload would drop state such as shares loaded in recovery mode. */
  autoReload: boolean;
}

export function buildClientHeader(version: string, build: string): string {
  return `web/${version} (build ${build || "dev"}); mpc=${CLIENT_MPC_PROTOCOLS.join(",")}`;
}

/** True for our own API: the configured API origin, or same-origin /api/ paths. */
export function isApiRequest(url: string, apiBase: string, pageOrigin: string): boolean {
  let u: URL;
  try { u = new URL(url, pageOrigin); } catch { return false; }
  if (apiBase) {
    const base = new URL(apiBase, pageOrigin);
    return u.origin === base.origin && u.pathname.startsWith(base.pathname.replace(/\/$/, ""));
  }
  return u.origin === pageOrigin && (u.pathname === "/api" || u.pathname.startsWith("/api/"));
}

/** The 426 body when `res` is the gate's refusal, else null. Reads a clone so the caller still owns the body. */
export async function readUpdateRequired(res: Response): Promise<UpdateRequired | null> {
  if (res.status !== 426) return null;
  try {
    const body = await res.clone().json() as { error?: string; platform?: string; minSupported?: string };
    if (body.error !== "update_required") return null;
    return { platform: body.platform ?? "web", minSupported: body.minSupported ?? "", autoReload: true };
  } catch {
    return null;
  }
}

type Listener = (info: UpdateRequired) => void;
const listeners = new Set<Listener>();
let current: UpdateRequired | null = null;

/** Late subscribers (the screen mounts after the first request) still see an earlier refusal. */
export function subscribeUpdateRequired(fn: Listener): () => void {
  listeners.add(fn);
  if (current) fn(current);
  return () => { listeners.delete(fn); };
}

export function notifyUpdateRequired(info: UpdateRequired): void {
  // Only a 426 may upgrade an earlier chunk-error notice (to auto-reload); nothing else re-notifies.
  if (current && (current.autoReload || !info.autoReload)) return;
  current = info;
  listeners.forEach((fn) => fn(info));
}

/** Wrap a fetch so API requests carry the header and a 426 raises the update screen. */
export function withClientHeader(base: typeof fetch, header: string, apiBase: string, pageOrigin: string): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isApiRequest(url, apiBase, pageOrigin)) return base(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(CLIENT_HEADER)) headers.set(CLIENT_HEADER, header);
    const res = await base(input, { ...init, headers });
    const info = await readUpdateRequired(res);
    if (info) notifyUpdateRequired(info);
    return res;
  };
}

declare const __APP_VERSION__: string;
declare const __GIT_HASH__: string;

/** Install once at startup (main.tsx), before any API call. */
export function installClientVersionGate(): void {
  const header = buildClientHeader(__APP_VERSION__, __GIT_HASH__);
  window.fetch = withClientHeader(window.fetch.bind(window), header, API_BASE, window.location.origin);
  // A tab older than the last deploy asks for chunks that are gone: same cure as a 426.
  // Offline, the chunk is merely unreachable and a reload would only show the browser's error page.
  // The import error still reaches its caller (no preventDefault).
  window.addEventListener("vite:preloadError", () => {
    if (!navigator.onLine) return;
    notifyUpdateRequired({ platform: "web", minSupported: "", autoReload: false });
  });
}
