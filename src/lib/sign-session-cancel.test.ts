// Web sign cancel: the open session is cancelled with the caller's auth (never the single-use passkey
// ticket), and an init that gets 409 because of it is sent once more after the cancel.
import { afterEach, describe, expect, test } from "bun:test";

const g = globalThis as Record<string, unknown>;
const store = new Map<string, string>([["secretkey-lang", "en"]]);
g.localStorage ??= { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };

const { signSessionStarted, signSessionFinished, cancelOpenSignSession, cancelStaleSignSession, openSignSessionId } = await import("./sign-session-cancel");
const { createHttpTransport, performMpcSign } = await import("./mpc");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
function fakeFetch(answer: (url: string, n: number) => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body ?? "{}")) });
    return answer(url, calls.length);
  }) as typeof fetch;
  return calls;
}

describe("sign session cancel", () => {
  test("review: a failed cancel keeps the session for the next try; a retry waits for a cancel in flight", async () => {
    let fail = true;
    const calls = fakeFetch(() => (fail ? new Response("down", { status: 502 }) : Response.json({ ok: true })));
    signSessionStarted("mpc-0:k", { Authorization: "Bearer t" });
    expect(await cancelOpenSignSession()).toBe(false);
    fail = false;
    const first = cancelOpenSignSession(); // e.g. after a failed sign, not awaited
    expect(await cancelOpenSignSession()).toBe(true); // the 409 retry joins it
    expect(await first).toBe(true);
    expect(calls.map((c) => c.body.sessionId)).toEqual(["mpc-0:k", "mpc-0:k"]);
  });

  test("review: a 409 that is not SESSION_ACTIVE (e.g. after the ticket was used) is never resent", async () => {
    signSessionStarted("mpc-0:s3", { Authorization: "Bearer t" });
    const calls = fakeFetch(() => Response.json({ error: "This scheduled send was already used or cancelled" }, { status: 409 }));
    const t = createHttpTransport({ initUrl: "/api/sign/init", stepUrl: "/api/sign/step", headers: {}, retryOn409: cancelOpenSignSession });
    expect(await t.transport.send(1, new Uint8Array([1]))).toBe(-1);
    expect(calls).toHaveLength(1);
    signSessionFinished("mpc-0:s3");
  });

  test("cancels the open session once, with the auth header and without the passkey ticket", async () => {
    const calls = fakeFetch(() => Response.json({ ok: true }));
    signSessionStarted("mpc-0:s1", { Authorization: "Bearer t", "x-passkey-token": "ticket" });
    expect(await cancelOpenSignSession()).toBe(true);
    expect(await cancelOpenSignSession()).toBe(false); // nothing open any more
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toEndWith("/api/sign/cancel");
    expect(calls[0].body).toEqual({ sessionId: "mpc-0:s1" });
    expect(calls[0].headers.Authorization).toBe("Bearer t");
    expect(calls[0].headers["x-passkey-token"]).toBeUndefined();
  });

  test("a finished sign leaves nothing to cancel", async () => {
    const calls = fakeFetch(() => Response.json({ ok: true }));
    signSessionStarted("mpc-0:s2", { Authorization: "Bearer t" });
    signSessionFinished("mpc-0:s2");
    expect(await cancelOpenSignSession()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("review: a 4xx cancel answer drops the session (nothing to retry)", async () => {
    fakeFetch(() => Response.json({ error: "Session not found" }, { status: 404 }));
    signSessionStarted("mpc-0:gone", { Authorization: "Bearer t" });
    expect(await cancelOpenSignSession()).toBe(false);
    expect(openSignSessionId()).toBeNull();
  });

  test("review: a second sign that fails before starting a session leaves the running one alone", async () => {
    signSessionStarted("mpc-0:running", { Authorization: "Bearer t" });
    const calls = fakeFetch(() => Response.json({ error: "Another operation is in progress", code: "SESSION_ACTIVE" }, { status: 409 }));
    await expect(performMpcSign({ algorithm: "ecdsa", keyId: "no-such-key", hash: new Uint8Array(32), initPayload: {}, headers: {} })).rejects.toThrow();
    expect(calls.filter((c) => c.url.endsWith("/api/sign/cancel"))).toHaveLength(0);
    expect(openSignSessionId()).toBe("mpc-0:running");
    signSessionFinished("mpc-0:running");
  });

  test("review: a 409 never cancels a sign still running in this tab", async () => {
    signSessionStarted("mpc-0:live", { Authorization: "Bearer t" });
    const calls = fakeFetch(() => Response.json({ error: "Another operation is in progress", code: "SESSION_ACTIVE" }, { status: 409 }));
    const t = createHttpTransport({ initUrl: "/api/sign/init", stepUrl: "/api/sign/step", headers: {}, retryOn409: cancelStaleSignSession });
    expect(await t.transport.send(1, new Uint8Array([1]))).toBe(-1);
    expect(calls).toHaveLength(1); // no cancel, no resend
    signSessionFinished("mpc-0:live");
  });

  test("init 409 caused by our own stale session: cancel it, send the same init once more", async () => {
    // A failed sign whose cancel did not get through leaves its session stale.
    signSessionStarted("mpc-0:stale", { Authorization: "Bearer t" });
    fakeFetch(() => new Response("down", { status: 502 }));
    expect(await cancelOpenSignSession()).toBe(false);
    const calls = fakeFetch((url, n) => {
      if (url.endsWith("/api/sign/cancel")) return Response.json({ ok: true });
      return n === 1 ? Response.json({ error: "Another operation is in progress", code: "SESSION_ACTIVE" }, { status: 409 })
        : Response.json({ sessionId: "mpc-0:new", done: false, message: "AQ==" });
    });
    const started: string[] = [];
    const t = createHttpTransport({ initUrl: "/api/sign/init", stepUrl: "/api/sign/step", headers: { "x-passkey-token": "ticket" },
      onSession: (id) => started.push(id), retryOn409: cancelStaleSignSession });
    expect(await t.transport.send(1, new Uint8Array([1]))).toBe(0);
    expect(calls.map((c) => c.url.replace(/^.*\/api/, ""))).toEqual(["/sign/init", "/sign/cancel", "/sign/init"]);
    expect(calls[1].body).toEqual({ sessionId: "mpc-0:stale" });
    expect(calls[2].headers["x-passkey-token"]).toBe("ticket"); // the 409 did not use the ticket
    expect(started).toEqual(["mpc-0:new"]);
    expect(t.getError()).toBeNull();
  });

  test("409 with nothing of ours to cancel: no retry, the error stands", async () => {
    const calls = fakeFetch(() => Response.json({ error: "Another operation is in progress", code: "SESSION_ACTIVE" }, { status: 409 }));
    const t = createHttpTransport({ initUrl: "/api/sign/init", stepUrl: "/api/sign/step", headers: {}, retryOn409: cancelStaleSignSession });
    expect(await t.transport.send(1, new Uint8Array([1]))).toBe(-1);
    expect(calls).toHaveLength(1);
    expect(t.getError()?.message).toBe("Another operation is in progress");
  });
});
