// Real cb-mpc (WASM) checks of how long the client share lives: handles are built from
// wipeable bytes, the bytes are zeroed, and handles are freed on clear / recovery exit.
import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { CbMpc, DataTransport } from "cb-mpc";

// Browser globals the modules touch at import time.
const store = new Map<string, string>([["secretkey-lang", "en"]]);
const g = globalThis as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };

type Mpc = typeof import("./mpc");
type Keystore = typeof import("./keystore");
type Recovery = typeof import("./recovery");
let mpcMod: Mpc;
let keystore: Keystore;
let recovery: Recovery;
let mpc0: CbMpc;
let mpc1: CbMpc;
let ecdsa: [Uint8Array[], Uint8Array[]]; // serialized parts of party 0 / 1
let eddsa: [Uint8Array[], Uint8Array[]];

const NAMES: [string, string] = ["client", "server"];
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const join = (parts: Uint8Array[]) => parts.map(b64).join(",");
const copy = (parts: Uint8Array[]) => parts.map((p) => new Uint8Array(p));
const allZero = (parts: Uint8Array[]) => parts.every((p) => p.every((b) => b === 0));

function localPair(): [DataTransport, DataTransport] {
  const q: [Uint8Array[], Uint8Array[]] = [[], []]; // q[i] = inbox of party i
  const waiters: [(() => void) | null, (() => void) | null] = [null, null];
  const make = (me: 0 | 1): DataTransport => {
    const t: DataTransport = {
      send: async (_r, m) => { q[1 - me].push(new Uint8Array(m)); waiters[1 - me]?.(); waiters[1 - me] = null; return 0; },
      receive: async () => {
        while (!q[me].length) await new Promise<void>((r) => { waiters[me] = r; });
        return q[me].shift()!;
      },
      receiveAll: async (s) => Promise.all(s.map((x) => t.receive(x))),
    };
    return t;
  };
  return [make(0), make(1)];
}

beforeAll(async () => {
  mpcMod = await import("./mpc");
  keystore = await import("./keystore");
  recovery = await import("./recovery");
  mpc0 = await mpcMod.getMpcInstance();
  const { initCbMpc } = await import("cb-mpc");
  // @ts-expect-error -- cb-mpc has no type declarations
  const mod = await import("cb-mpc/cbmpc.js");
  mpc1 = await initCbMpc((mod.default || mod) as Parameters<typeof initCbMpc>[0]);

  let [t0, t1] = localPair();
  const [e0, e1] = await Promise.all([
    mpc0.ecdsa2pDkg(t0, 0, NAMES, mpcMod.NID_secp256k1),
    mpc1.ecdsa2pDkg(t1, 1, NAMES, mpcMod.NID_secp256k1),
  ]);
  [t0, t1] = localPair();
  const [d0, d1] = await Promise.all([
    mpc0.ecKey2pDkg(t0, 0, NAMES, mpcMod.NID_ED25519),
    mpc1.ecKey2pDkg(t1, 1, NAMES, mpcMod.NID_ED25519),
  ]);
  ecdsa = [mpc0.serializeEcdsa2p(e0), mpc1.serializeEcdsa2p(e1)];
  eddsa = [mpc0.serializeEcKey2p(d0), mpc1.serializeEcKey2p(d1)];
  mpc0.freeEcdsa2pKey(e0); mpc1.freeEcdsa2pKey(e1);
  mpc0.freeEcKey2p(d0); mpc1.freeEcKey2p(d1);
}, 60_000);

/** Sign with the cached party-0 handle against a fresh party-1 handle: proves the restore is usable. */
async function signsWithCachedKey(keyId: string): Promise<boolean> {
  const entry = mpcMod.clientKeys.get(keyId)!;
  const peer = mpc1.deserializeEcdsa2p(copy(ecdsa[1]));
  try {
    const [t0, t1] = localPair();
    const sid = crypto.getRandomValues(new Uint8Array(32));
    const hash = crypto.getRandomValues(new Uint8Array(32));
    const [sigs] = await Promise.all([
      mpc0.ecdsa2pSign(t0, 0, NAMES, entry.ecdsa!, sid, [hash]),
      mpc1.ecdsa2pSign(t1, 1, NAMES, peer, sid, [hash]),
    ]);
    return sigs[0].length > 0;
  } finally {
    mpc1.freeEcdsa2pKey(peer);
  }
}

describe("client key handles", () => {
  test("restore from parts wipes the parts, signs, and clear frees both handles", async () => {
    const e = copy(ecdsa[0]);
    const d = copy(eddsa[0]);
    await mpcMod.restoreKeyHandlesFromParts("k-parts", e, d);
    expect(allZero(e) && allZero(d)).toBe(true);
    expect(await signsWithCachedKey("k-parts")).toBe(true);

    const entry = mpcMod.clientKeys.get("k-parts")!;
    const [ecdsaHandle, eddsaHandle] = [entry.ecdsa, entry.eddsa];
    const proto = Object.getPrototypeOf(mpc0);
    const freeE = spyOn(proto, "freeEcdsa2pKey");
    const freeD = spyOn(proto, "freeEcKey2p");
    mpcMod.clearClientKey("k-parts");
    expect(freeE).toHaveBeenCalledWith(ecdsaHandle!);
    expect(freeD).toHaveBeenCalledWith(eddsaHandle!);
    expect(mpcMod.clientKeys.has("k-parts")).toBe(false);
    freeE.mockRestore(); freeD.mockRestore();
  });

  test("restore from a key-file string still works (unencrypted / passphrase files)", async () => {
    await mpcMod.restoreKeyHandles("k-str", join(ecdsa[0]), join(eddsa[0]));
    expect(await signsWithCachedKey("k-str")).toBe(true);
    mpcMod.clearClientKey("k-str");
  });

  test("a bad share wipes the parts and caches nothing", async () => {
    const junk = [crypto.getRandomValues(new Uint8Array(40))];
    await expect(mpcMod.restoreKeyHandlesFromParts("k-bad", junk, [])).rejects.toThrow();
    expect(allZero(junk)).toBe(true);
    expect(mpcMod.clientKeys.has("k-bad")).toBe(false);
  });
});

describe("PRF unlock for signing", () => {
  test("decrypts the share into parts only and wipes the plaintext", async () => {
    const prfKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const file = { id: "k-prf", peer: 1, share: join(ecdsa[0]), publicKey: "02ab", eddsaShare: join(eddsa[0]), eddsaPublicKey: "ed" };
    await keystore.saveKeyShareWithPrf("k-prf", file, prfKey, "cred", "standalone");

    const decrypt = spyOn(crypto.subtle, "decrypt");
    const parts = (await keystore.getKeySharePartsWithPrf("k-prf", prfKey))!;
    const plain = new Uint8Array((await decrypt.mock.results[0].value) as ArrayBuffer);
    decrypt.mockRestore();

    expect(parts.ecdsa).toEqual(ecdsa[0]);
    expect(parts.eddsa).toEqual(eddsa[0]);
    expect(parts.meta).toMatchObject({ id: "k-prf", publicKey: "02ab", eddsaPublicKey: "ed", share: "", eddsaShare: "" });
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((b) => b === 0)).toBe(true);

    await mpcMod.restoreKeyHandlesFromParts("k-prf", parts.ecdsa, parts.eddsa);
    expect(allZero(parts.ecdsa) && allZero(parts.eddsa)).toBe(true);
    expect(await signsWithCachedKey("k-prf")).toBe(true);
    mpcMod.clearClientKey("k-prf");
  });

  test("a wrong passkey gives null", async () => {
    const other = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    expect(await keystore.getKeySharePartsWithPrf("k-prf", other)).toBeNull();
  });
});

describe("recovery mode", () => {
  test("exit frees all four handles", async () => {
    const proto = Object.getPrototypeOf(mpc0);
    const p1 = { id: "k-rec", peer: 1, share: join(ecdsa[0]), publicKey: "", eddsaShare: join(eddsa[0]), eddsaPublicKey: "" };
    const p2 = { ...p1, peer: 2, share: join(ecdsa[1]), eddsaShare: join(eddsa[1]) };
    await recovery.enterRecoveryMode(p1, p2);
    expect(recovery.isRecoveryMode()).toBe(true);
    const sig = await recovery.performLocalMpcSign({ algorithm: "ecdsa", keyId: "k-rec", hash: new Uint8Array(32).fill(1) });
    expect(sig.signature.length).toBeGreaterThan(0);

    const freeE = spyOn(proto, "freeEcdsa2pKey");
    const freeD = spyOn(proto, "freeEcKey2p");
    recovery.exitRecoveryMode();
    expect(freeE).toHaveBeenCalledTimes(2);
    expect(freeD).toHaveBeenCalledTimes(2);
    freeE.mockRestore(); freeD.mockRestore();
    await expect(recovery.performLocalMpcSign({ algorithm: "ecdsa", keyId: "k-rec", hash: new Uint8Array(32) })).rejects.toThrow();
  }, 30_000);

  test("exit during a local sign frees the handles only after the sign ends", async () => {
    const proto = Object.getPrototypeOf(mpc0);
    const p1 = { id: "k-rec2", peer: 1, share: join(ecdsa[0]), publicKey: "", eddsaShare: "", eddsaPublicKey: "" };
    const p2 = { ...p1, peer: 2, share: join(ecdsa[1]) };
    await recovery.enterRecoveryMode(p1, p2);
    const freeE = spyOn(proto, "freeEcdsa2pKey");
    const run = recovery.performLocalMpcSign({ algorithm: "ecdsa", keyId: "k-rec2", hash: new Uint8Array(32).fill(2) });
    recovery.exitRecoveryMode();
    expect(freeE).not.toHaveBeenCalled();
    expect((await run).signature.length).toBeGreaterThan(0);
    expect(freeE).toHaveBeenCalledTimes(2);
    freeE.mockRestore();
  }, 30_000);

  test("a mismatched recovery pair rejects the sign (no hang)", async () => {
    // Party 1 from another key: the protocol fails on one side; the other must not hang on receive.
    let [t0, t1] = localPair();
    const [, other1] = await Promise.all([
      mpc0.ecdsa2pDkg(t0, 0, NAMES, mpcMod.NID_secp256k1),
      mpc1.ecdsa2pDkg(t1, 1, NAMES, mpcMod.NID_secp256k1),
    ]);
    [t0, t1] = localPair();
    const p1 = { id: "k-bad-pair", peer: 1, share: join(ecdsa[0]), publicKey: "", eddsaShare: "", eddsaPublicKey: "" };
    const p2 = { ...p1, peer: 2, share: join(mpc1.serializeEcdsa2p(other1)) };
    mpc1.freeEcdsa2pKey(other1);
    await recovery.enterRecoveryMode(p1, p2);
    const run = recovery.performLocalMpcSign({ algorithm: "ecdsa", keyId: "k-bad-pair", hash: new Uint8Array(32).fill(3) });
    const outcome = await Promise.race([
      run.then(() => "signed", () => "rejected"),
      new Promise((r) => setTimeout(() => r("hung"), 15_000)),
    ]);
    recovery.exitRecoveryMode();
    expect(outcome).toBe("rejected");
  }, 30_000);
});

describe("transport failures end the WASM run (no suspended call, no pinned handle)", () => {
  const settle = (p: Promise<unknown>) => Promise.race([
    p.then(() => "resolved", () => "rejected"),
    new Promise((r) => setTimeout(() => r("hung"), 10_000)),
  ]);

  test("HTTP: a network failure on send rejects the sign and the race", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("network down"))) as unknown as typeof fetch;
    const key = mpc0.deserializeEcdsa2p(copy(ecdsa[0]));
    try {
      const http = mpcMod.createHttpTransport({ initUrl: "/i", stepUrl: "/s", headers: {} });
      const run = mpc0.ecdsa2pSign(http.transport, 0, NAMES, key, new Uint8Array(32), [new Uint8Array(32).fill(4)]);
      expect(await settle(run)).toBe("rejected");
      expect(await settle(http.transportFailed)).toBe("rejected");
      expect(http.getError()?.message).toBe("network down");
    } finally {
      globalThis.fetch = realFetch;
      mpc0.freeEcdsa2pKey(key);
    }
  }, 30_000);

  test("HTTP: a done reply still gives the protocol an empty message", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ sessionId: "x", done: true }))) as unknown as typeof fetch;
    try {
      const ok = mpcMod.createHttpTransport({ initUrl: "/i", stepUrl: "/s", headers: {} }).transport;
      expect(await ok.send(1, new Uint8Array([1]))).toBe(0);
      expect((await ok.receive(1)).length).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("local: aborting the transport ends a peer waiting for a message that never comes", async () => {
    const { t0, abort } = recovery.createLocalTransport();
    const key = mpc0.deserializeEcdsa2p(copy(ecdsa[0]));
    try {
      const run = mpc0.ecdsa2pSign(t0, 0, NAMES, key, new Uint8Array(32), [new Uint8Array(32).fill(5)]);
      setTimeout(() => abort(new Error("peer failed")), 200);
      expect(await settle(run)).toBe("rejected");
    } finally {
      mpc0.freeEcdsa2pKey(key);
    }
  }, 30_000);
});
