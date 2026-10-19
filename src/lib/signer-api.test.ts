// Device signer: message bytes, signature format (verifies against the SPKI), the x1 share proof (verifies
// against Q - Q2 like the API does), and the /sign/init fields (nonce right before init, digests of `data`).
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { p256 } from "@noble/curves/nist.js";

const g = globalThis as Record<string, unknown>;
const session = new Map<string, string>();
const local = new Map<string, string>();
g.sessionStorage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
g.localStorage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) };
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };

const key = await import("./device-signer-key");
key.signerStorage.allowMemoryOnly = true; // no IndexedDB in bun: memory-only keys may register here
const api = await import("./signer-api");
const { clientKeys } = await import("./client-key-cache");
const { setToken, clearToken } = await import("./auth");
// bun runs every test file in one process: never leave a login behind for the next file.
afterAll(() => clearToken());
const { clearWorkspaceTokens } = await import("./workspace-token");

const n = secp256k1.Point.CURVE().n;
const G = secp256k1.Point.BASE;
const KS = "11111111-2222-3333-4444-555555555555";
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "HS256" })}.${b64url(claims)}.sig`;
const text = (m: Uint8Array) => new TextDecoder().decode(m);
async function sha256Hex(s: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

describe("messages", () => {
  test("exact strings", () => {
    expect(text(key.registerMessage("ks", "ab", "cd"))).toBe("kexify-signer:v1:register:ks:ab:cd");
    expect(text(key.signMessage("ks", "nn", ["d1", "d2"]))).toBe("kexify-signer:v1:sign:ks:nn:d1,d2");
    expect(text(key.signerActionMessage("revoke", "ks", "t", "nn"))).toBe("kexify-signer:v1:revoke:ks:t:nn");
    expect(text(key.signerActionMessage("activate", "ks", "t", "nn"))).toBe("kexify-signer:v1:activate:ks:t:nn");
  });

  test("key is non-extractable P-256; raw r||s signature verifies against the SPKI point; fingerprint is sha256 of the DER", async () => {
    const rec = await key.getOrCreateSignerRecord("ks-sig");
    expect(rec.privateKey.extractable).toBe(false);
    const der = fromB64(rec.spki);
    expect(der.length).toBe(91);
    expect(hex(der.subarray(0, 26))).toBe("3059301306072a8648ce3d020106082a8648ce3d030107034200");
    const msg = key.signMessage("ks-sig", "00".repeat(32), ["ab"]);
    const sig = fromB64(await key.deviceSign(rec, msg));
    expect(sig.length).toBe(64);
    expect(p256.verify(sig, msg, der.subarray(26), { format: "compact", lowS: false })).toBe(true);
    expect(p256.verify(sig, key.signMessage("ks-sig", "11".repeat(32), ["ab"]), der.subarray(26), { format: "compact", lowS: false })).toBe(false);
    expect(await key.spkiFingerprint(rec.spki)).toBe(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", der))));
    expect((await key.getOrCreateSignerRecord("ks-sig")).spki).toBe(rec.spki); // stable per workspace
  });
});

describe("register + sign init fields", () => {
  const realFetch = globalThis.fetch;
  const x1 = BigInt("0x" + hex(secp256k1.utils.randomSecretKey())) % n;
  const x2 = BigInt("0x" + hex(secp256k1.utils.randomSecretKey())) % n;
  const Q = G.multiply((x1 + x2) % n);
  let calls: { path: string; body: Record<string, string> | undefined }[] = [];
  let nonceN = 0;
  let registerCheck: Promise<void> | null = null;

  beforeEach(() => {
    clearToken();
    clearWorkspaceTokens();
    setToken(jwt({ sub: "u1", sid: "s1", ws: KS, exp: Math.floor(Date.now() / 1000) + 900 }));
    const xShare = Uint8Array.from(x1.toString(16).padStart(64, "0").match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    clientKeys.set(KS, { mpc: { ecdsa2pKeyInfo: () => ({ roleIndex: 0, xShare: xShare.slice() }) }, ecdsa: {} } as never);
    calls = [];
    nonceN = 0;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/signers/, "") || "/";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path, body });
      if (path === "/challenge") return Response.json({ challengeId: "c1", challenge: "ab".repeat(16), message: "server-supplied-text-never-signed" });
      if (path === "/nonce") return Response.json({ nonce: String(++nonceN).padStart(64, "0") });
      if (path === "/") {
        registerCheck = (async () => {
          const rec = await key.getSignerRecord(KS);
          const msg = key.registerMessage(KS, await key.spkiFingerprint(rec!.spki), "ab".repeat(16));
          const point = fromB64(rec!.spki).subarray(26);
          expect(p256.verify(fromB64(body!.deviceSig), msg, point, { format: "compact", lowS: false })).toBe(true);
          // x1 proof verifies against Q1 = Q - Q2 (what the API checks)
          const Q1 = Q.add(G.multiply(x2).negate());
          expect(secp256k1.verify(Uint8Array.from(body!.shareProof.match(/.{2}/g)!.map((h) => parseInt(h, 16))), msg, Q1.toBytes(true))).toBe(true);
          expect(body!.label).toBeTruthy();
        })();
        return Response.json({ signer: { id: "sig-1", status: "active" }, activeSigner: null });
      }
      return Response.json({}, { status: 404 });
    }) as never;
  });
  afterEach(() => { globalThis.fetch = realFetch; clientKeys.delete(KS); });

  test("silent register once; then sign fields: nonce after register, sig over sha256 hex of each data string", async () => {
    const data = ["AAEC", "AwQF"];
    const f = await api.signerFieldsForInit(KS, data);
    await registerCheck;
    expect(calls.map((c) => c.path)).toEqual(["/challenge", "/", "/nonce"]);
    expect(f!.signerId).toBe("sig-1");
    expect(f!.signerNonce).toBe("1".padStart(64, "0"));
    const rec = await key.getSignerRecord(KS);
    expect(rec).toMatchObject({ signerId: "sig-1", status: "active" });
    const msg = key.signMessage(KS, f!.signerNonce, [await sha256Hex("AAEC"), await sha256Hex("AwQF")]);
    expect(p256.verify(fromB64(f!.signerSig), msg, fromB64(rec!.spki).subarray(26), { format: "compact", lowS: false })).toBe(true);

    calls = [];
    await api.signerFieldsForInit(KS, data); // registered now: only a fresh nonce
    expect(calls.map((c) => c.path)).toEqual(["/nonce"]);
  });

  test("no client share in memory -> no fields (server decides); a refusal marks the wallet View only", async () => {
    clientKeys.delete(KS);
    await key.putSignerRecord({ ...(await key.getOrCreateSignerRecord("ks-other")), signerId: undefined });
    expect(await api.signerFieldsForInit("ks-other", ["AAEC"])).toBeNull();
    await key.setLocalSignerState("ks-other", { signerId: "x", status: "active" }, (await key.getSignerRecord("ks-other"))!.spki);
    await api.noteSignerRefused("ks-other", "SIGNER_NOT_ACTIVE");
    expect((await key.getSignerRecord("ks-other"))!.status).toBe("pending");
    await api.noteSignerRefused("ks-other", "SIGNER_BAD_SIG");
    expect((await key.getSignerRecord("ks-other"))!.status).toBe("pending");
    await api.noteSignerRefused("ks-other", "SIGNER_REVOKED");
    expect((await key.getSignerRecord("ks-other"))!.status).toBe("revoked");
  });
});

test("web device label", () => {
  expect(api.webDeviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36")).toBe("Chrome on macOS");
});

describe("review fixes", () => {
  const realFetch = globalThis.fetch;
  const WS = "ws-review";
  let calls: string[] = [];
  let nextStatus: "active" | "pending" = "active";
  let regN = 0;
  const putShare = () => clientKeys.set(WS, { mpc: { ecdsa2pKeyInfo: () => ({ roleIndex: 0, xShare: Uint8Array.from({ length: 32 }, (_, i) => i + 1) }) }, ecdsa: {} } as never);

  beforeEach(() => {
    clearToken();
    clearWorkspaceTokens();
    setToken(jwt({ sub: "u1", sid: "s1", ws: WS, exp: Math.floor(Date.now() / 1000) + 900 }));
    calls = [];
    nextStatus = "active";
    regN = 0;
    globalThis.fetch = (async (url: string) => {
      const path = String(url).replace(/^.*\/signers/, "") || "/";
      calls.push(path);
      if (path === "/challenge") return Response.json({ challengeId: "c", challenge: "ab".repeat(16) });
      if (path === "/nonce") return Response.json({ nonce: "7".repeat(64) });
      if (path === "/") return Response.json({ signer: { id: `sig-${++regN}`, status: nextStatus } });
      return Response.json({}, { status: 404 });
    }) as never;
  });
  afterEach(() => { globalThis.fetch = realFetch; clientKeys.delete(WS); });

  // Each test starts with no record for WS: drop it by registering under a unique id per test.
  const uniq = (name: string) => `${WS}-${name}`;

  test("2: concurrent first creation yields one key; state patch only for the registered spki", async () => {
    const id = uniq("tabs");
    const [a, b] = await Promise.all([key.getOrCreateSignerRecord(id), key.getOrCreateSignerRecord(id)]);
    expect(a.spki).toBe(b.spki);
    await key.setLocalSignerState(id, { signerId: "other", status: "active" }, "different-spki");
    expect((await key.getSignerRecord(id))!.signerId).toBeUndefined();
    await key.setLocalSignerState(id, { signerId: "mine", status: "active" }, a.spki);
    expect((await key.getSignerRecord(id))!.signerId).toBe("mine");
  });

  test("P3: clear / state updates for another spki are no-ops; revoked replacement only if the old key is still stored", async () => {
    const id = uniq("cas");
    const a = await key.getOrCreateSignerRecord(id);
    await key.setLocalSignerState(id, { signerId: "s1", status: "revoked" }, a.spki);
    await key.clearLocalSignerId(id, "other-spki");
    expect((await key.getSignerRecord(id))!.signerId).toBe("s1");
    const [r1, r2] = await Promise.all([key.getOrCreateSignerRecord(id), key.getOrCreateSignerRecord(id)]);
    expect(r1.spki).not.toBe(a.spki);
    expect((await key.getSignerRecord(id))!.spki).toBe((await key.getSignerRecord(id))!.spki);
    expect([r1.spki, r2.spki]).toContain((await key.getSignerRecord(id))!.spki);
  });

  test("P3: a memory-only key never registers (without the test seam)", async () => {
    const id = uniq("volatile");
    clientKeys.set(id, { mpc: { ecdsa2pKeyInfo: () => ({ roleIndex: 0, xShare: Uint8Array.from({ length: 32 }, (_, i) => i + 1) }) }, ecdsa: {} } as never);
    key.signerStorage.allowMemoryOnly = false;
    try {
      expect(await api.ensureSigner(id)).toBeNull();
      expect(calls).toEqual([]);
    } finally {
      key.signerStorage.allowMemoryOnly = true;
      clientKeys.delete(id);
    }
  });

  test("3: SIGNER_UNKNOWN drops the stale id, keeps the key, and the next sign registers again", async () => {
    const id = uniq("unknown");
    clientKeys.set(id, { mpc: { ecdsa2pKeyInfo: () => ({ roleIndex: 0, xShare: Uint8Array.from({ length: 32 }, (_, i) => i + 1) }) }, ecdsa: {} } as never);
    setToken(jwt({ sub: "u1", sid: "s1", ws: id, exp: Math.floor(Date.now() / 1000) + 900 }));
    const first = (await api.ensureSigner(id))!;
    expect(first.signerId).toBe("sig-1");
    await api.noteSignerRefused(id, "SIGNER_UNKNOWN");
    const after = (await key.getSignerRecord(id))!;
    expect(after.signerId).toBeUndefined();
    expect(after.spki).toBe(first.spki);
    expect((await api.ensureSigner(id))!.signerId).toBe("sig-2");
    clientKeys.delete(id);
  });

  test("4: a revoked local key is replaced by a NEW key and the new id is used", async () => {
    const id = uniq("revoked");
    clientKeys.set(id, { mpc: { ecdsa2pKeyInfo: () => ({ roleIndex: 0, xShare: Uint8Array.from({ length: 32 }, (_, i) => i + 1) }) }, ecdsa: {} } as never);
    setToken(jwt({ sub: "u1", sid: "s1", ws: id, exp: Math.floor(Date.now() / 1000) + 900 }));
    const old = (await api.ensureSigner(id))!;
    await api.noteSignerRefused(id, "SIGNER_REVOKED");
    await api.takeOverSigning(id); // the server gives the new key the free slot (active): nothing left to activate
    const now = (await key.getSignerRecord(id))!;
    expect(now.spki).not.toBe(old.spki);
    expect(now.signerId).toBe("sig-2");
    expect(now.status).toBe("active");
    clientKeys.delete(id);
  });

  test("1: locked share + no signer: ticket (unlock) first, then register, then nonce + sig", async () => {
    setToken(jwt({ sub: "u1", sid: "s1", ws: WS, exp: Math.floor(Date.now() / 1000) + 900 }));
    const out = await api.authorizeWithSigner({
      keyShareId: WS, dataB64: ["AAEC"], shareLocked: true,
      getTicket: async () => { calls.push("TICKET"); putShare(); return "t"; },
    });
    expect(out.ticket).toBe("t");
    expect(calls).toEqual(["TICKET", "/challenge", "/", "/nonce"]);
    expect(out.fields.signerId).toBe("sig-1");
  });

  test("1: share loaded -> normal order (fields before the ticket)", async () => {
    putShare();
    await api.authorizeWithSigner({ keyShareId: WS, dataB64: ["AAEC"], shareLocked: false, getTicket: async () => { calls.push("TICKET"); return "t"; } });
    expect(calls).toEqual(["/nonce", "TICKET"]); // signer from the previous test is already registered
  });

  test("1: locked share, new key lands pending -> stops with SIGNER_NOT_ACTIVE, no nonce", async () => {
    const id = uniq("pending");
    setToken(jwt({ sub: "u1", sid: "s1", ws: id, exp: Math.floor(Date.now() / 1000) + 900 }));
    nextStatus = "pending";
    await expect(api.authorizeWithSigner({
      keyShareId: id, dataB64: ["AAEC"], shareLocked: true,
      getTicket: async () => { clientKeys.set(id, { mpc: { ecdsa2pKeyInfo: () => ({ roleIndex: 0, xShare: Uint8Array.from({ length: 32 }, (_, i) => i + 1) }) }, ecdsa: {} } as never); return "t"; },
    })).rejects.toMatchObject({ code: "SIGNER_NOT_ACTIVE" });
    expect(calls).not.toContain("/nonce");
    expect((await key.getSignerRecord(id))!.status).toBe("pending");
    clientKeys.delete(id);
  });
});
