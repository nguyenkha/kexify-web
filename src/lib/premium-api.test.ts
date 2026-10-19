import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { claimCryptoIntent, createCryptoIntent, getEntitlement, listCryptoIntents } from "./premium-api";

const realFetch = globalThis.fetch;
// A session token for authHeaders(), installed for this file only: a global stub left behind would
// shadow the session store of the test files that run after this one.
const g = globalThis as { sessionStorage?: unknown };
const realSessionStorage = g.sessionStorage;
beforeAll(() => { g.sessionStorage = { getItem: () => "tok", setItem() {}, removeItem() {} }; });
afterAll(() => { if (realSessionStorage === undefined) delete g.sessionStorage; else g.sessionStorage = realSessionStorage; });
afterEach(() => { globalThis.fetch = realFetch; });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function mock(res: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return res(); }) as typeof fetch;
  return calls;
}

describe("premium api client", () => {
  test("getEntitlement returns data on 200", async () => {
    const calls = mock(() => json(200, { entitlement: { plan: "free", state: "none" }, crypto: { enabled: true } }));
    const r = await getEntitlement();
    expect(r.ok && r.data.crypto.enabled).toBe(true);
    expect(calls[0].url).toContain("/api/entitlement");
  });

  test("listCryptoIntents unwraps intents; errors carry the code", async () => {
    mock(() => json(200, { intents: [{ id: "a" }] }));
    const ok = await listCryptoIntents();
    expect(ok.ok && ok.intents.length).toBe(1);
    mock(() => json(503, { error: "off", code: "crypto_payments_disabled" }));
    const bad = await listCryptoIntents();
    expect(bad).toMatchObject({ ok: false, status: 503, code: "crypto_payments_disabled" });
  });

  test("createCryptoIntent posts the choice and accepts 200 and 201", async () => {
    const calls = mock(() => json(201, { intent: { id: "i1", amount: "5.991234" }, reference: "KX-ABCD1234" }));
    const r = await createCryptoIntent({ product: "monthly", chain: "base", token: "USDC" });
    expect(r.ok && r.reference).toBe("KX-ABCD1234");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ product: "monthly", chain: "base", token: "USDC" });
    mock(() => json(400, { error: "Unsupported product, chain or token" }));
    expect(await createCryptoIntent({ product: "yearly", chain: "tron", token: "USDC" })).toMatchObject({ ok: false, code: "bad_request" });
  });

  test("claim: credited, confirming (202), and error codes", async () => {
    mock(() => json(200, { status: "credited", intent: { id: "i1" }, entitlement: { plan: "premium" } }));
    expect(await claimCryptoIntent("i1", " 0xabc ")).toMatchObject({ ok: true, status: "credited" });
    mock(() => json(202, { status: "confirming" }));
    expect(await claimCryptoIntent("i1", "0xabc")).toEqual({ ok: true, status: "confirming" });
    mock(() => json(422, { error: "x", code: "amount_mismatch", received: "5.5" }));
    expect(await claimCryptoIntent("i1", "0xabc")).toMatchObject({ ok: false, status: 422, code: "amount_mismatch", received: "5.5" });
    mock(() => json(410, { error: "x", code: "intent_expired" }));
    expect(await claimCryptoIntent("i1", "0xabc")).toMatchObject({ ok: false, code: "intent_expired" });
  });

  test("network failure maps to code network", async () => {
    globalThis.fetch = (async () => { throw new TypeError("offline"); }) as typeof fetch;
    expect(await getEntitlement()).toMatchObject({ ok: false, status: 0, code: "network" });
  });
});
