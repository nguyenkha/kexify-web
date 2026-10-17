// Passkey sign-in: options -> discoverable assertion -> verify; session stored, errors mapped
// to sign-in codes, and an autofill request never starts over a modal prompt.
import { afterEach, describe, expect, test } from "bun:test";

const g = globalThis as Record<string, unknown>;
const local = new Map<string, string>();
const session = new Map<string, string>();
const storage = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
g.localStorage ??= storage(local);
g.sessionStorage ??= storage(session);
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };

const { signInWithPasskey, passkeyModalActive } = await import("./passkey-sign-in");
const { AuthError, getToken } = await import("./auth");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; sessionStorage.removeItem("secretkey_token"); });

const jwt = (sub: string) => `x.${btoa(JSON.stringify({ sub, email: "a@b.c" }))}.y`;
type Call = { url: string; body: Record<string, unknown>; credentials?: RequestCredentials };
function fakeFetch(verify: () => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")), credentials: init?.credentials });
    if (url.endsWith("/auth/passkey/options")) return Response.json({ challengeId: "ch1", options: { challenge: "c", rpId: "localhost", allowCredentials: [] } });
    return verify();
  }) as typeof fetch;
  return calls;
}
const assertion = { id: "cred", rawId: "cred", type: "public-key", response: {}, clientExtensionResults: {} };
const okAssertion = (async () => assertion) as never;

async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (err) { if (err instanceof AuthError) return err.code; throw err; }
  return "none";
}

describe("passkey sign-in", () => {
  test("sends the assertion with the challenge id, stores the session", async () => {
    const calls = fakeFetch(() => Response.json({ token: jwt("u1"), ttl: 900 }));
    let seen: { useBrowserAutofill?: boolean; optionsJSON?: { challenge: string } } = {};
    const token = await signInWithPasskey({ getAssertion: (async (o: typeof seen) => { seen = o; return assertion; }) as never });
    expect(seen.useBrowserAutofill).toBe(false);
    expect(seen.optionsJSON?.challenge).toBe("c");
    expect(calls.map((c) => c.url)).toEqual(["/api/auth/passkey/options", "/api/auth/passkey/verify"]);
    expect(calls[1].body).toEqual({ challengeId: "ch1", credential: assertion });
    expect(calls[1].credentials).toBe("include");
    expect(getToken()).toBe(token);
  });

  test("server refusals map to sign-in error codes", async () => {
    fakeFetch(() => Response.json({ error: "Passkey sign-in failed" }, { status: 400 }));
    expect(await codeOf(signInWithPasskey({ getAssertion: okAssertion }))).toBe("passkeyFailed");
    fakeFetch(() => Response.json({ error: "Invalid or expired challenge" }, { status: 400 }));
    expect(await codeOf(signInWithPasskey({ getAssertion: okAssertion }))).toBe("passkeyExpired");
    fakeFetch(() => Response.json({ error: "Account is frozen", code: "account_frozen" }, { status: 403 }));
    expect(await codeOf(signInWithPasskey({ getAssertion: okAssertion }))).toBe("accountFrozen");
    fakeFetch(() => Response.json({ error: "Too many requests" }, { status: 429 }));
    expect(await codeOf(signInWithPasskey({ getAssertion: okAssertion }))).toBe("rateLimited");
    expect(getToken()).toBeNull();
  });

  test("a dismissed prompt is 'cancelled' and nothing is verified", async () => {
    const calls = fakeFetch(() => Response.json({ token: jwt("u1") }));
    const dismissed = (async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); }) as never;
    expect(await codeOf(signInWithPasskey({ getAssertion: dismissed }))).toBe("passkeyCancelled");
    expect(calls).toHaveLength(1);
  });

  test("a sign-in stopped while verifying does not store its session", async () => {
    const stop = new AbortController();
    fakeFetch(() => { stop.abort(); return Response.json({ token: jwt("old-account") }); });
    expect(await codeOf(signInWithPasskey({ autofill: true, signal: stop.signal, getAssertion: okAssertion }))).toBe("passkeyCancelled");
    expect(getToken()).toBeNull();
  });

  test("an autofill request does not start while the modal prompt runs, nor after it was stopped", async () => {
    fakeFetch(() => Response.json({ token: jwt("u1") }));
    let release!: () => void;
    const modal = signInWithPasskey({ getAssertion: (() => new Promise((r) => { release = () => r(assertion); })) as never });
    while (!passkeyModalActive()) await new Promise((r) => setTimeout(r, 1));
    let autofillPrompted = false;
    const autofill = signInWithPasskey({ autofill: true, getAssertion: (async () => { autofillPrompted = true; return assertion; }) as never });
    expect(await codeOf(autofill)).toBe("passkeyCancelled");
    expect(autofillPrompted).toBe(false);
    release();
    await modal;
    expect(passkeyModalActive()).toBe(false);

    const stop = new AbortController();
    stop.abort();
    expect(await codeOf(signInWithPasskey({ autofill: true, signal: stop.signal, getAssertion: okAssertion }))).toBe("passkeyCancelled");
  });
});
