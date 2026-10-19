// End-to-end encryption of the client share from the old device to the new one (the server only relays).
// shared = X25519(sender eph priv, receiver eph pub); key = HKDF-SHA256(shared, salt = nonce bytes,
// info = "kexify-move:v1:<transferId>", 32 bytes); AES-256-GCM, 12-byte IV, AAD binds wallet, device key,
// nonce and transfer. ciphertext = base64(iv || ct || tag). Same on iOS.
import { x25519 } from "@noble/curves/ed25519.js";
import { b64, fromB64, fromHex, utf8 } from "./move-codec";
import { wipe } from "../secret-bytes";

export interface MoveContext {
  keyShareId: string;
  transferId: string;
  /** 64 hex chars (the QR's). */
  nonce: string;
  /** sha256 hex of the new device's SPKI DER. */
  devicePubkeySha256: string;
}

export const moveAad = (c: MoveContext) => utf8(`kexify-move:v1:${c.keyShareId}:${c.devicePubkeySha256}:${c.nonce}:${c.transferId}`);

/** A fresh ephemeral X25519 key pair (memory only; wipe `secretKey` after use). */
export function newEphemeralKeyPair(): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

async function aesKey(secretKey: Uint8Array, peerPublic: Uint8Array, transferId: string, nonce: string): Promise<CryptoKey> {
  const shared = x25519.getSharedSecret(secretKey, peerPublic);
  try {
    const ikm = await crypto.subtle.importKey("raw", shared as BufferSource, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: fromHex(nonce) as BufferSource, info: utf8(`kexify-move:v1:${transferId}`) as BufferSource },
      ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
    );
  } finally {
    wipe(shared);
  }
}

/** Old device: encrypt `plaintext` to the QR's ephemeral key. Wipes its own ephemeral secret. */
export async function sealForNewDevice(ctx: MoveContext, receiverEphPubkey: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: string; senderEphPubkey: string }> {
  const eph = newEphemeralKeyPair();
  try {
    const key = await aesKey(eph.secretKey, receiverEphPubkey, ctx.transferId, ctx.nonce);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: moveAad(ctx) as BufferSource }, key, plaintext as BufferSource));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return { ciphertext: b64(out), senderEphPubkey: b64(eph.publicKey) };
  } finally {
    wipe(eph.secretKey);
  }
}

/** New device: decrypt with its ephemeral secret. Throws on a wrong key, a changed AAD or a tampered ciphertext. */
export async function openFromOldDevice(ctx: MoveContext, secretKey: Uint8Array, ciphertextB64: string, senderEphPubkeyB64: string): Promise<Uint8Array> {
  const data = fromB64(ciphertextB64);
  if (data.length < 12 + 16) throw new Error("ciphertext too short");
  const key = await aesKey(secretKey, fromB64(senderEphPubkeyB64), ctx.transferId, ctx.nonce);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: data.slice(0, 12), additionalData: moveAad(ctx) as BufferSource }, key, data.slice(12),
  ));
}
