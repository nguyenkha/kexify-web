// Workspace tokens: cached per workspace, re-fetched near expiry, standalone tokens pass through, and the cache is
// dropped when the login changes.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const g = globalThis as Record<string, unknown>;
const session = new Map<string, string>();
const local = new Map<string, string>();
g.sessionStorage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
g.localStorage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) };
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };

const { workspaceHeaders, clearWorkspaceTokens } = await import("./workspace-token");
const { setToken, clearToken } = await import("./auth");

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;
const now = () => Math.floor(Date.now() / 1000);

const realFetch = globalThis.fetch;
let calls: { url: string; auth: string; body: { workspaceId: string } }[] = [];
let ttl = 900;
let fail = false;
let n = 0;

beforeEach(() => {
  calls = []; ttl = 900; fail = false; n = 0;
  clearWorkspaceTokens();
  session.clear(); local.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(input), auth: (init?.headers as Record<string, string>).Authorization, body });
    if (fail) return new Response("{}", { status: 404 });
    return Response.json({ token: jwt({ sub: "u1", sid: "s1", ws: body.workspaceId, exp: now() + ttl, n: ++n }), ttl, workspaceId: body.workspaceId });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const account = (extra: Record<string, unknown> = {}) => jwt({ sub: "u1", sid: "s1", exp: now() + 900, ...extra });
const wsOf = (h: Record<string, string>) => JSON.parse(atob(h.Authorization.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).ws;

describe("workspaceHeaders", () => {
  test("exchanges the account token once per workspace and caches it", async () => {
    setToken(account());
    const a = await workspaceHeaders("k1");
    const b = await workspaceHeaders("k1");
    expect(a).toEqual(b);
    expect(wsOf(a)).toBe("k1");
    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain("/api/auth/workspace");
    expect(calls[0].auth).toBe(`Bearer ${session.get("secretkey_token")}`);
    await workspaceHeaders("k2");
    expect(calls.length).toBe(2);
  });

  test("refetches when less than 120 s are left", async () => {
    setToken(account());
    ttl = 100;
    await workspaceHeaders("k1");
    await workspaceHeaders("k1");
    expect(calls.length).toBe(2);
  });

  test("account token refresh (same login) keeps the cache; a different login drops it", async () => {
    setToken(account());
    await workspaceHeaders("k1");
    setToken(account({ iat: 1 })); // refresh: same sub + sid
    await workspaceHeaders("k1");
    expect(calls.length).toBe(1);
    setToken(jwt({ sub: "u2", sid: "s9", exp: now() + 900 }));
    await workspaceHeaders("k1");
    expect(calls.length).toBe(2);
  });

  test("sign-out clears the cache", async () => {
    setToken(account());
    await workspaceHeaders("k1");
    clearToken();
    expect(await workspaceHeaders("k1")).toEqual({});
    setToken(account());
    await workspaceHeaders("k1");
    expect(calls.length).toBe(2);
  });

  test("standalone token (already has ws) is used as is, no request", async () => {
    const t = jwt({ sub: "k1", type: "standalone", ws: "k1", exp: now() + 900 });
    setToken(t);
    expect(await workspaceHeaders("k1")).toEqual({ Authorization: `Bearer ${t}` });
    expect(calls.length).toBe(0);
  });

  test("standalone token asked for another workspace goes through the exchange, not passthrough", async () => {
    setToken(jwt({ sub: "k1", type: "standalone", ws: "k1", sid: "s1", exp: now() + 900 }));
    const h = await workspaceHeaders("k2");
    expect(calls.length).toBe(1);
    expect(wsOf(h)).toBe("k2");
  });

  test("a token fetched for a login that signed out meanwhile is not cached", async () => {
    setToken(account());
    const pending = workspaceHeaders("k1");
    clearToken();
    setToken(jwt({ sub: "u2", sid: "s2", exp: now() + 900 }));
    await pending;
    await workspaceHeaders("k1");
    expect(calls.length).toBe(2); // the u2 login fetched its own
  });

  test("404 from the exchange: strict callers get WorkspaceNotFoundError, others the account token", async () => {
    const { workspaceToken, WorkspaceNotFoundError } = await import("./workspace-token");
    const t = account();
    setToken(t);
    fail = true;
    await expect(workspaceToken("k1", { strict: true })).rejects.toBeInstanceOf(WorkspaceNotFoundError);
    expect(await workspaceToken("k1")).toBe(t);
  });

  test("a failed exchange falls back to the account token", async () => {
    const t = account();
    setToken(t);
    fail = true;
    expect(await workspaceHeaders("k1")).toEqual({ Authorization: `Bearer ${t}` });
  });

  test("signed out: no header", async () => {
    expect(await workspaceHeaders("k1")).toEqual({});
  });
});
