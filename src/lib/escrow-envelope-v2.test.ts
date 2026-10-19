import { describe, expect, test } from "bun:test";
import { x25519 } from "@noble/curves/ed25519.js";
import type { KeyFileData } from "./crypto";
import { b64, fromB64 } from "./device-move/move-codec";
import { EnvelopeOpenError, isEnvelopeV2, openEnvelopeV2, sealEnvelopeV2 } from "./escrow-envelope-v2";
import { escrowPublicKey, escrowSecretFromPrf } from "./passkey-escrow-key";

const keyFile: KeyFileData = {
  id: "ks-1", peer: 0, share: "AAEC,AwQF", publicKey: "02ABCDEF", eddsaShare: "BgcI", eddsaPublicKey: "edpub", type: "email",
};

async function recipient(fill = 7) {
  const secret = await escrowSecretFromPrf(new Uint8Array(32).fill(fill));
  return { secret, key: b64(escrowPublicKey(secret)) };
}

const seal = (key: string, over: Partial<{ credentialId: string; generation: number; keyShareId: string }> = {}) =>
  sealEnvelopeV2({ keyShareId: "ks-1", credentialId: "cred-A", generation: 3, recipientKey: key, keyFile, ...over });

const open = (data: string, secret: Uint8Array, over: Partial<{ credentialId: string; generation: number; keyShareId: string; publicKey: string }> = {}) =>
  openEnvelopeV2(data, { keyShareId: "ks-1", credentialId: "cred-A", generation: 3, publicKey: "02abcdef", escrowSecret: secret, ...over });

describe("escrow key", () => {
  test("is deterministic per PRF output and 32 bytes", async () => {
    const a = await escrowSecretFromPrf(new Uint8Array(32).fill(1));
    const b = await escrowSecretFromPrf(new Uint8Array(32).fill(1));
    const c = await escrowSecretFromPrf(new Uint8Array(32).fill(2));
    expect(a.length).toBe(32);
    expect(b64(a)).toBe(b64(b));
    expect(b64(a)).not.toBe(b64(c));
    expect(escrowPublicKey(a).length).toBe(32);
  });
});

describe("envelope v2", () => {
  test("round trip carries the key file and its generation", async () => {
    const r = await recipient();
    const data = await seal(r.key);
    expect(isEnvelopeV2(data)).toBe(true);
    const env = JSON.parse(data);
    expect(env).toMatchObject({ mode: "prf-x25519", v: 1, credentialId: "cred-A", shareGeneration: 3 });
    expect(fromB64(env.epk).length).toBe(32);
    expect(fromB64(env.iv).length).toBe(12);
    const back = await open(data, r.secret);
    expect(back).toMatchObject({ id: "ks-1", share: keyFile.share, eddsaShare: keyFile.eddsaShare, shareGeneration: 3 });
  });

  test("a wrong escrow key fails", async () => {
    const r = await recipient(7);
    const other = await recipient(8);
    await expect(open(await seal(r.key), other.secret)).rejects.toBeInstanceOf(EnvelopeOpenError);
  });

  test("info / AAD bound: another wallet, passkey or generation fails", async () => {
    const r = await recipient();
    const data = await seal(r.key);
    await expect(open(data, r.secret, { keyShareId: "ks-2" })).rejects.toBeInstanceOf(EnvelopeOpenError);
    await expect(open(data, r.secret, { credentialId: "cred-B" })).rejects.toBeInstanceOf(EnvelopeOpenError);
    await expect(open(data, r.secret, { generation: 4 })).rejects.toBeInstanceOf(EnvelopeOpenError);
    // A relabelled envelope (credentialId / generation changed in the JSON) breaks the AAD.
    const env = JSON.parse(data);
    await expect(open(JSON.stringify({ ...env, credentialId: "cred-B" }), r.secret, { credentialId: "cred-B" })).rejects.toBeInstanceOf(EnvelopeOpenError);
    await expect(open(JSON.stringify({ ...env, shareGeneration: 4 }), r.secret, { generation: 4 })).rejects.toBeInstanceOf(EnvelopeOpenError);
  });

  test("tampered ciphertext fails", async () => {
    const r = await recipient();
    const env = JSON.parse(await seal(r.key));
    const ct = fromB64(env.ciphertext);
    ct[0] ^= 1;
    await expect(open(JSON.stringify({ ...env, ciphertext: b64(ct) }), r.secret)).rejects.toBeInstanceOf(EnvelopeOpenError);
  });

  test("a key file of another wallet public key is refused", async () => {
    const r = await recipient();
    await expect(open(await seal(r.key), r.secret, { publicKey: "03ffff" })).rejects.toBeInstanceOf(EnvelopeOpenError);
  });

  test("seal refuses a bad recipient key or a key file of another wallet", async () => {
    const r = await recipient();
    await expect(seal(b64(new Uint8Array(31)))).rejects.toThrow();
    await expect(seal(r.key, { keyShareId: "ks-2" })).rejects.toThrow();
  });

  test("matches an independent X25519 + HKDF computation", async () => {
    const r = await recipient();
    const env = JSON.parse(await seal(r.key));
    const shared = x25519.getSharedSecret(r.secret, fromB64(env.epk));
    const salt = new Uint8Array([...fromB64(env.epk), ...fromB64(r.key)]);
    const info = new TextEncoder().encode("kexify-escrow:v1:ks-1:cred-A:3");
    const ikm = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info }, ikm, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv), additionalData: info }, key, fromB64(env.ciphertext));
    expect(JSON.parse(new TextDecoder().decode(plain)).shareGeneration).toBe(3);
  });
});

describe("refresh carries approvals", () => {
  test("one v2 envelope per approved passkey; replaces its legacy one, keeps slot and password", async () => {
    const { withApprovedPasskeys } = await import("./device-move/move-escrow-envelopes");
    const r = await recipient();
    const base = [
      { credentialId: "cred-A", rpId: "app.kexify.co", encryptedData: "legacy" },
      { credentialId: "slot", encryptedData: "legacy" },
      { credentialId: "passphrase", encryptedData: "pw" },
    ];
    const out = (await withApprovedPasskeys(base, [{ credentialId: "cred-A", name: "Mac", escrowKey: r.key, approved: true }], { ...keyFile, shareGeneration: 4 }, 4))!;
    expect(out.map((e) => e.credentialId).sort()).toEqual(["cred-A", "passphrase", "slot"]);
    const a = out.find((e) => e.credentialId === "cred-A")!;
    expect((await open(a.encryptedData, r.secret, { generation: 4 })).shareGeneration).toBe(4);
    expect(await withApprovedPasskeys(base, [], keyFile, 4)).toBe(base);
  });
});

// Shared with iOS (CryptoKit, cross-checked with noble): both platforms must produce exactly these values.
describe("cross-platform vector", () => {
  const seq = (from: number, n: number) => Uint8Array.from({ length: n }, (_, i) => from + i);
  const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  test("escrow key and envelope v2", async () => {
    const priv = await escrowSecretFromPrf(new Uint8Array(32).fill(0x42));
    expect(hexOf(priv)).toBe("52298502fea9e47f58cefcb8dd18fb3ad25e8947f540eee53c02cf129aedc274");
    const escrowKey = b64(escrowPublicKey(priv));
    expect(escrowKey).toBe("6rfB6AFojKuymk7O8iO8+h4RYNPZd0wU6VqCWAPWMzc=");
    const { sealEnvelopeV2With } = await import("./escrow-envelope-v2");
    const kf: KeyFileData = { id: "ks-vector", peer: 1, share: "c2hhcmU=", publicKey: "02abcd", eddsaShare: "", eddsaPublicKey: "", type: "email" };
    const data = await sealEnvelopeV2With({ keyShareId: "ks-vector", credentialId: "cred-1", generation: 3, recipientKey: escrowKey, keyFile: kf }, seq(1, 32), seq(0, 12));
    const env = JSON.parse(data);
    expect(env.epk).toBe("B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=");
    expect(env.iv).toBe("AAECAwQFBgcICQoL");
    expect(env.ciphertext).toBe("dj/bTLXIyAZYHv2qFnKRv+SPiyXuRyyeDioZ2j3n8OkebXkdQqLaj5WodXBqqTtaw6ywKN1+L99/J9V4SF1ENAm1Vet4ljPmSJiTgOuOlg6S8sM2mVdW5OSk/V9x0L154ttVp2GZJ7guENwV/rDk/af+kZOZ91TDCfA/JkXecrMKR5zmG+jWsw4ydGFaS9RpKEkCYksVqNxg8w==");
    const back = await openEnvelopeV2(data, { keyShareId: "ks-vector", credentialId: "cred-1", generation: 3, publicKey: "02abcd", escrowSecret: priv });
    expect(back.shareGeneration).toBe(3);
  });
});
