// Phase 3: decline / device-signed activate wire format, alert email device auth, public link results,
// alert lines and device facts.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { p256 } from "@noble/curves/nist.js";

const g = globalThis as Record<string, unknown>;
const session = new Map<string, string>();
const local = new Map<string, string>();
g.sessionStorage ??= { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
g.localStorage ??= { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) };
g.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, location: { href: "" } };
// Another test file may have set a window without location (full `bun test src` run order).
(g.window as { location?: { href: string } }).location ??= { href: "" };

const key = await import("./device-signer-key");
const api = await import("./signer-api");
const alerts = await import("./security-alerts-api");
const { alertLine, alertKindKey } = await import("./security-alert-text");
const facts = await import("./device-facts");
const { signerErrorMessage } = await import("./signer-error-message");
const { setToken, clearToken } = await import("./auth");
const { clearWorkspaceTokens } = await import("./workspace-token");
afterAll(() => clearToken());

const KS = "aaaaaaaa-2222-3333-4444-555555555555";
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const verify = (sig: string, msg: Uint8Array, spki: string) => p256.verify(fromB64(sig), msg, fromB64(spki).subarray(26), { format: "compact", lowS: false });
// Minimal t(): key plus interpolated values, so tests see which key and which facts were used.
const t = ((k: string, o?: Record<string, unknown>) => (o ? `${k}|${Object.entries(o).map(([a, b]) => `${a}=${b}`).join(",")}` : k)) as never;

const realFetch = globalThis.fetch;
type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
let calls: Call[] = [];
let reply: (c: Call) => Response;

beforeEach(() => {
  clearToken();
  clearWorkspaceTokens();
  setToken(jwt({ sub: "u1", sid: "s1", ws: KS, exp: Math.floor(Date.now() / 1000) + 900 }));
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const c = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    if (c.url.endsWith("/signers/nonce")) return Response.json({ nonce: "9".repeat(64) });
    if (c.url.endsWith("/signers")) return Response.json({ signers: [] });
    return reply(c);
  }) as never;
});
afterEach(() => { globalThis.fetch = realFetch; });

async function activeRecord() {
  const rec = await key.getOrCreateSignerRecord(KS);
  await key.setLocalSignerState(KS, { signerId: "me", status: "active" }, rec.spki);
  return (await key.getSignerRecord(KS))!;
}

describe("decline + device-signed activate", () => {
  test("decline message string", () => {
    expect(new TextDecoder().decode(key.signerActionMessage("decline", "ks", "t", "nn"))).toBe("kexify-signer:v1:decline:ks:t:nn");
    expect(new TextDecoder().decode(key.alertEmailMessage("ks", "none", "nn"))).toBe("kexify-signer:v1:alert-email:ks:none:nn");
  });

  test("declineSigner posts { by, nonce, sig } over the decline message and returns frozen", async () => {
    const rec = await activeRecord();
    reply = () => Response.json({ signer: { id: "new", status: "revoked", revokeReason: "declined" }, frozen: true });
    const out = await api.declineSigner(KS, "new");
    expect(out.frozen).toBe(true);
    const post = calls.find((c) => c.url.endsWith("/signers/new/decline"))!;
    expect(post.method).toBe("POST");
    expect(post.body!.by).toBe("me");
    expect(verify(String(post.body!.sig), key.signerActionMessage("decline", KS, "new", String(post.body!.nonce)), rec.spki)).toBe(true);
  });

  test("device-signed activate returns the server row; COOLING_IN_PROGRESS surfaces as a code", async () => {
    await activeRecord();
    reply = () => Response.json({ signer: { id: "new", status: "active" } });
    expect((await api.activateSigner(KS, "new", true))?.status).toBe("active");
    reply = () => Response.json({ code: "COOLING_IN_PROGRESS", signerId: "x" }, { status: 409 });
    const err = await api.activateSigner(KS, "new", true).catch((e) => e);
    expect(err).toBeInstanceOf(api.SignerApiError);
    expect(err.code).toBe("COOLING_IN_PROGRESS");
    expect(signerErrorMessage(err, t)).toBe("signers.error.coolingInProgress");
    expect(signerErrorMessage(new api.SignerApiError(409, "MOVE_PENDING"), t)).toBe("signers.error.movePending");
    expect(signerErrorMessage(new api.SignerApiError(429, "RATE_LIMITED"), t)).toBe("signers.error.rateLimited");
  });
});

describe("alert email", () => {
  test("active signer authorises with its device key over sha256(trimmed lower-case email)", async () => {
    const rec = await activeRecord();
    reply = () => Response.json({ ok: true, pending: true });
    expect(await alerts.setAlertEmail(KS, "  Me@Example.COM ")).toEqual({ pending: true });
    const put = calls.find((c) => c.url.endsWith(`/keys/${KS}/alert-email`))!;
    expect(put.method).toBe("PUT");
    expect(put.body!.email).toBe("me@example.com");
    const sha = await (await import("./passkey")).sha256Hex("me@example.com");
    expect(verify(String(put.body!.sig), key.alertEmailMessage(KS, sha, String(put.body!.nonce)), rec.spki)).toBe(true);
  });

  test("remove sends email null and signs 'none'", async () => {
    const rec = await activeRecord();
    reply = () => Response.json({ ok: true, alertEmail: null });
    expect(await alerts.setAlertEmail(KS, "")).toEqual({ pending: false });
    const put = calls.find((c) => c.url.endsWith("/alert-email"))!;
    expect(put.body!.email).toBeNull();
    expect(verify(String(put.body!.sig), key.alertEmailMessage(KS, "none", String(put.body!.nonce)), rec.spki)).toBe(true);
  });
});

describe("public links", () => {
  test("decline link results", async () => {
    const cases: [Response, string][] = [
      [Response.json({ ok: true, frozen: true }), "stoppedFrozen"],
      [Response.json({ ok: true, frozen: false }), "stopped"],
      [Response.json({ ok: false, code: "ALREADY_ACTIVE" }, { status: 409 }), "alreadyActive"],
      [Response.json({ ok: false, code: "ALREADY_STOPPED" }, { status: 409 }), "alreadyStopped"],
      [Response.json({ error: "Link expired" }, { status: 400 }), "expired"],
      [Response.json({}, { status: 500 }), "failed"],
    ];
    for (const [res, want] of cases) {
      reply = () => res;
      expect(await alerts.declineByEmailLink("tok")).toBe(want as never);
    }
    expect(calls.at(-1)!.body).toEqual({ token: "tok" });
    expect(calls.at(-1)!.url).toEndWith("/api/auth/signer-decline");
  });

  test("confirm email link results", async () => {
    reply = () => Response.json({ ok: true });
    expect(await alerts.confirmAlertEmail("tok")).toBe("confirmed");
    reply = () => Response.json({}, { status: 400 });
    expect(await alerts.confirmAlertEmail("tok")).toBe("expired");
    expect(calls.at(-1)!.url).toEndWith("/api/auth/alert-email/confirm");
  });
});

describe("alert lines + device facts", () => {
  test("known kinds map to their key, unknown to a generic line", () => {
    expect(alertKindKey("signer.cooling_started")).toBe("signer_cooling_started");
    expect(alertKindKey("alert_email.changed")).toBe("alert_email_changed");
    expect(alertKindKey("something.new")).toBe("unknown");
  });

  test("line uses server facts, unknown country wording, wallet name prefix", () => {
    const line = alertLine({ id: "1", kind: "login.new", keyShareId: null, meta: { platform: "ios", country: null, walletName: "Main" }, createdAt: "", readAt: null }, t, "en");
    expect(line).toBe("Main: alerts.kind.login_new|platform=deviceFacts.platform.ios,country=deviceFacts.unknownCountry,device=deviceFacts.platform.ios");
    expect(facts.countryName("VN", "en", t)).toBe("Vietnam");
    expect(facts.platformName("android", t)).toBe("deviceFacts.platform.unknown");
  });

  test("wait left rounds up and never goes negative", () => {
    const now = Date.parse("2026-10-19T00:00:00Z");
    expect(facts.waitLeft("2026-10-19T23:59:30Z", t, now)).toBe("deviceFacts.waitHm|h=24,m=0");
    expect(facts.waitLeft("2026-10-19T00:10:00Z", t, now)).toBe("deviceFacts.waitM|m=10");
    expect(facts.waitLeft("2026-10-18T00:00:00Z", t, now)).toBe("deviceFacts.waitM|m=0");
  });
});

describe("review r1", () => {
  test("401 session_revoked signs out (unless held) and is not retried with a passkey", async () => {
    const { holdSessionEndRedirect } = await import("./session-ended");
    await activeRecord();
    const loc = (globalThis as unknown as { window: { location: { href: string } } }).window.location;
    loc.href = "";
    reply = () => Response.json({ code: "session_revoked" }, { status: 401 });
    holdSessionEndRedirect(true);
    try {
      await expect(api.revokeSigner(KS, "other")).rejects.toMatchObject({ status: 401, code: "session_revoked" });
      expect(loc.href).toBe(""); // held: the locked screen stays
      expect(calls.some((c) => c.url.includes("/passkeys/"))).toBe(false);
    } finally {
      holdSessionEndRedirect(false);
    }
    await expect(api.revokeSigner(KS, "other")).rejects.toMatchObject({ code: "session_revoked" });
    expect(loc.href).toBe("/login?session=ended");
  });

  test("alert email: a device-key error other than 403 surfaces (no silent passkey fallback)", async () => {
    await activeRecord();
    reply = () => Response.json({ code: "RATE_LIMITED" }, { status: 429 });
    await expect(alerts.setAlertEmail(KS, "a@b.co")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(calls.some((c) => c.url.includes("/passkeys/"))).toBe(false);
  });
});
