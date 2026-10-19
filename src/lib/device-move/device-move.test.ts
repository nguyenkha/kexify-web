// QR device move: QR text, transfer crypto, backup envelopes and the exact signer message strings
// (must equal api/src/signer-verify.ts on feat/p4-device-move-api).
import { describe, expect, test } from "bun:test";
import { encodeMoveQr, parseMoveQr, qrMatchesServer } from "./move-qr-text";
import { b64, b64url, fromB64url, utf8 } from "./move-codec";
import { moveAad, newEphemeralKeyPair, openFromOldDevice, sealForNewDevice } from "./move-transfer-crypto";
import { envelopesFor, envelopesJson } from "./move-escrow-envelopes";
import { escrowMessage, refreshMessage, transferApproveMessage, transferClaimMessage, transferRejectMessage } from "./move-signer-messages";

const text = (m: Uint8Array) => new TextDecoder().decode(m);
const NONCE = "ab".repeat(32);
const TID = "0f6c2b1e-1111-4222-8333-444455556666";
const KS = "11111111-2222-3333-4444-555555555555";
const spki = Uint8Array.from({ length: 91 }, (_, i) => (i * 7) & 0xff);
const eph = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);

describe("QR text", () => {
  test("round trip, base64url without padding", () => {
    const s = encodeMoveQr({ transferId: TID, nonce: NONCE, ephPubkey: eph, devicePubkey: spki });
    expect(s).toBe(`kexify-move:v1:${TID}:${NONCE}:${b64url(eph)}:${b64url(spki)}`);
    expect(s).not.toContain("=");
    const q = parseMoveQr(` ${s}\n`)!;
    expect(q.transferId).toBe(TID);
    expect(q.nonce).toBe(NONCE);
    expect([...q.ephPubkey]).toEqual([...eph]);
    expect([...q.devicePubkey]).toEqual([...spki]);
  });

  test("rejects anything malformed", () => {
    const good = encodeMoveQr({ transferId: TID, nonce: NONCE, ephPubkey: eph, devicePubkey: spki });
    for (const bad of [
      "", "hello", good.replace("v1", "v2"), good + ":x", good.replace(NONCE, "AB".repeat(32)),
      `kexify-move:v1:${TID}:${NONCE}:${b64url(eph.slice(1))}:${b64url(spki)}`,
      `kexify-move:v1:${TID}:${NONCE}:${b64url(eph)}:${b64url(spki.slice(1))}`,
      `kexify-move:v1:${TID}:${NONCE}:${b64(eph)}+/:${b64url(spki)}`,
    ]) expect(parseMoveQr(bad)).toBeNull();
    expect(() => fromB64url("a+b")).toThrow();
  });

  test("server keys must equal the QR's", () => {
    const q = parseMoveQr(encodeMoveQr({ transferId: TID, nonce: NONCE, ephPubkey: eph, devicePubkey: spki }))!;
    const server = { transferId: TID, nonce: NONCE, ephPubkey: b64(eph), devicePubkey: b64(spki) };
    expect(qrMatchesServer(q, server)).toBe(true);
    const swapped = new Uint8Array(eph); swapped[0] ^= 1;
    expect(qrMatchesServer(q, { ...server, ephPubkey: b64(swapped) })).toBe(false);
    expect(qrMatchesServer(q, { ...server, devicePubkey: b64(spki.slice(0, 90)) })).toBe(false);
    expect(qrMatchesServer(q, { ...server, nonce: "cd".repeat(32) })).toBe(false);
    expect(qrMatchesServer(q, { ...server, transferId: "other" })).toBe(false);
  });
});

describe("transfer crypto", () => {
  const ctx = { keyShareId: KS, transferId: TID, nonce: NONCE, devicePubkeySha256: "ef".repeat(32) };
  const plain = () => utf8(JSON.stringify({ id: KS, share: "s1,s2", shareGeneration: 3 }));

  test("AAD string", () => {
    expect(text(moveAad(ctx))).toBe(`kexify-move:v1:${KS}:${"ef".repeat(32)}:${NONCE}:${TID}`);
  });

  test("round trip; ciphertext = iv || ct || tag", async () => {
    const recv = newEphemeralKeyPair();
    const sealed = await sealForNewDevice(ctx, recv.publicKey, plain());
    expect(atob(sealed.ciphertext).length).toBe(12 + plain().length + 16);
    expect(atob(sealed.senderEphPubkey).length).toBe(32);
    expect(text(await openFromOldDevice(ctx, recv.secretKey, sealed.ciphertext, sealed.senderEphPubkey))).toBe(text(plain()));
  });

  test("a different AAD (wallet, device key, nonce, transfer) fails", async () => {
    const recv = newEphemeralKeyPair();
    const sealed = await sealForNewDevice(ctx, recv.publicKey, plain());
    for (const other of [{ ...ctx, keyShareId: "x" }, { ...ctx, devicePubkeySha256: "00".repeat(32) }]) {
      await expect(openFromOldDevice(other, recv.secretKey, sealed.ciphertext, sealed.senderEphPubkey)).rejects.toThrow();
    }
    // nonce and transfer id also feed the HKDF salt / info
    await expect(openFromOldDevice({ ...ctx, nonce: "cd".repeat(32) }, recv.secretKey, sealed.ciphertext, sealed.senderEphPubkey)).rejects.toThrow();
    await expect(openFromOldDevice({ ...ctx, transferId: "t2" }, recv.secretKey, sealed.ciphertext, sealed.senderEphPubkey)).rejects.toThrow();
  });

  test("a wrong key or a tampered ciphertext fails", async () => {
    const recv = newEphemeralKeyPair();
    const sealed = await sealForNewDevice(ctx, recv.publicKey, plain());
    await expect(openFromOldDevice(ctx, newEphemeralKeyPair().secretKey, sealed.ciphertext, sealed.senderEphPubkey)).rejects.toThrow();
    await expect(openFromOldDevice(ctx, recv.secretKey, sealed.ciphertext, b64(newEphemeralKeyPair().publicKey))).rejects.toThrow();
    const raw = Uint8Array.from(atob(sealed.ciphertext), (c) => c.charCodeAt(0));
    raw[raw.length - 1] ^= 1;
    await expect(openFromOldDevice(ctx, recv.secretKey, b64(raw), sealed.senderEphPubkey)).rejects.toThrow();
  });
});

describe("backup envelopes", () => {
  test("PRF and password envelopes, always with the site slot copy (server names it); exact JSON", () => {
    const prf = envelopesFor("BLOB", "cred-1", "kexify.app");
    expect(envelopesJson(prf)).toBe('[{"credentialId":"cred-1","rpId":"kexify.app","encryptedData":"BLOB"},{"credentialId":"slot","encryptedData":"BLOB"}]');
    const pass = envelopesFor("P", "passphrase", undefined);
    expect(envelopesJson(pass)).toBe('[{"credentialId":"passphrase","encryptedData":"P"},{"credentialId":"slot","encryptedData":"P"}]');
  });

  test("escrow download message", () => {
    expect(text(escrowMessage(KS, "n1"))).toBe(`kexify-signer:v1:escrow:${KS}:n1`);
  });
});

describe("signer messages (api signer-verify.ts)", () => {
  test("transfer approve / reject / claim", () => {
    expect(text(transferApproveMessage(KS, TID, "fp", NONCE, "n1"))).toBe(`kexify-signer:v1:transfer:${KS}:${TID}:fp:${NONCE}:n1`);
    expect(text(transferRejectMessage(KS, TID, "n1"))).toBe(`kexify-signer:v1:transfer-reject:${KS}:${TID}:n1`);
    expect(text(transferClaimMessage(TID, NONCE))).toBe(`kexify-move:v1:claim:${TID}:${NONCE}`);
  });

  test("refresh steps", () => {
    expect(text(refreshMessage("init-ecdsa", KS, 1, "n"))).toBe(`kexify-signer:v1:refresh-init-ecdsa:${KS}:1:n`);
    expect(text(refreshMessage("init-eddsa", KS, 1, "n"))).toBe(`kexify-signer:v1:refresh-init-eddsa:${KS}:1:n`);
    expect(text(refreshMessage("backup", KS, 2, "n", "h"))).toBe(`kexify-signer:v1:refresh-backup:${KS}:2:n:h`);
    expect(text(refreshMessage("commit", KS, 2, "n"))).toBe(`kexify-signer:v1:refresh-commit:${KS}:2:n`);
  });
});
