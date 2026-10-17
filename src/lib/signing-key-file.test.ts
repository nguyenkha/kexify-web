// The share a flow signs with is resolved at the sign tap from the account's keyId:
// no key picker, a PRF share stays locked, a passphrase share asks for its passphrase.
import { beforeAll, describe, expect, test } from "bun:test";
import type { KeyFileData } from "./crypto";

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

let keystore: typeof import("./keystore");
let prompt: typeof import("./key-passphrase-prompt");
let resolver: typeof import("./signing-key-file");
let DEFERRED: string;

const file = (id: string): KeyFileData => ({
  id, peer: 0, share: `ecdsa-${id}`, publicKey: `02${id}`, eddsaShare: `eddsa-${id}`, eddsaPublicKey: `ed-${id}`,
});

beforeAll(async () => {
  keystore = await import("./keystore");
  prompt = await import("./key-passphrase-prompt");
  resolver = await import("./signing-key-file");
  DEFERRED = (await import("./mpc")).DEFERRED_PRF_SHARE;
  await keystore.saveKeyShareWithPassphrase("pp", file("pp"), "correct horse battery", "standalone");
  const prfKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await keystore.saveKeyShareWithPrf("prf", file("prf"), prfKey, "cred", "standalone");
});

describe("resolveSigningKeyFile", () => {
  test("a PRF share stays locked: a deferred file, no prompt before the signing passkey", async () => {
    const kf = await resolver.resolveSigningKeyFile("prf", { needsEddsa: true });
    expect(kf).toMatchObject({ id: "prf", publicKey: "02prf", eddsaPublicKey: "ed-prf", share: DEFERRED });
    expect(resolver.hasSigningShare("prf")).toBe(true);
  });

  test("a passphrase share asks for its passphrase at the tap; a wrong one keeps the prompt open", async () => {
    let wrong: unknown = null;
    const unsubscribe = prompt.subscribeKeyPassphrase(async (req) => {
      if (!req) return;
      expect(req.keyId).toBe("pp");
      try { await keystore.getKeyShareWithPassphrase(req.keyId, "nope"); } catch (e) { wrong = e; }
      req.resolve((await keystore.getKeyShareWithPassphrase(req.keyId, "correct horse battery"))!);
    });
    const kf = await resolver.resolveSigningKeyFile("pp", { needsEddsa: false });
    unsubscribe();
    expect(String(wrong)).toContain("Incorrect passphrase");
    expect(kf).toMatchObject({ id: "pp", share: "ecdsa-pp", eddsaShare: "eddsa-pp" });
  });

  test("dismissing the passphrase prompt cancels the sign", async () => {
    const unsubscribe = prompt.subscribeKeyPassphrase((req) => req?.reject(new prompt.KeyPassphraseCancelled()));
    await expect(resolver.resolveSigningKeyFile("pp", { needsEddsa: false })).rejects.toBeInstanceOf(prompt.KeyPassphraseCancelled);
    unsubscribe();
  });

  test("an uploaded file signs as given; with no share and no file there is nothing to sign with", async () => {
    const up = file("up");
    expect(await resolver.resolveSigningKeyFile("prf", { needsEddsa: true, uploaded: up })).toBe(up);
    expect(await resolver.resolveSigningKeyFile("none", { needsEddsa: false })).toBeNull();
    expect(resolver.hasSigningShare("none")).toBe(false);
  });
});

describe("requestKeyPassphrase", () => {
  test("cancelKeyPassphrase cancels only the prompt its own flow opened, and closes it", async () => {
    const seen: unknown[] = [];
    const unsubscribe = prompt.subscribeKeyPassphrase((r) => seen.push(r));
    const owner = {};
    const pending = prompt.requestKeyPassphrase("gone", owner);
    prompt.cancelKeyPassphrase({}); // another flow unmounting leaves it open
    expect(seen.at(-1)).not.toBeNull();
    prompt.cancelKeyPassphrase(owner);
    await expect(pending).rejects.toBeInstanceOf(prompt.KeyPassphraseCancelled);
    expect(seen.at(-1)).toBeNull();
    unsubscribe();
  });


  test("a newer request rejects the one it replaces; without a host it fails instead of hanging", async () => {
    const seen: (import("./key-passphrase-prompt").KeyPassphraseRequest | null)[] = [];
    const unsubscribe = prompt.subscribeKeyPassphrase((r) => seen.push(r));
    const first = prompt.requestKeyPassphrase("a");
    const second = prompt.requestKeyPassphrase("b");
    await expect(first).rejects.toBeInstanceOf(prompt.KeyPassphraseCancelled);
    seen[2]!.resolve(file("b"));
    expect((await second).id).toBe("b");
    expect(seen.map((r) => r?.keyId ?? null)).toEqual(["a", null, "b", null]); // the host closes each one
    unsubscribe();
    await expect(prompt.requestKeyPassphrase("c")).rejects.toThrow("passphrase_prompt_unavailable");
  });
});
