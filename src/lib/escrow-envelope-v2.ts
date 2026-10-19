// Passkey backup envelope v2 ("prf-x25519"): the wallet sealed TO a passkey's escrow key (passkey-escrow-key.ts),
// so the signing device can add any of the owner's passkeys without that passkey being here. Same on iOS:
// shared = X25519(eph, recipient); key = HKDF-SHA256(shared, salt = epk || recipientPub, info, 32);
// AES-256-GCM, 12-byte IV, AAD = info = "kexify-escrow:v1:<keyShareId>:<credentialId>:<g>".
import { x25519 } from "@noble/curves/ed25519.js";
import type { KeyFileData } from "./crypto";
import { wipe } from "./secret-bytes";
import { b64, bytesEqual, fromB64, utf8 } from "./device-move/move-codec";
import { newEphemeralKeyPair } from "./device-move/move-transfer-crypto";

export const ENVELOPE_V2_MODE = "prf-x25519";

export interface EnvelopeV2 {
  mode: typeof ENVELOPE_V2_MODE; v: 1; credentialId: string; shareGeneration: number; epk: string; iv: string; ciphertext: string;
}

export class EnvelopeOpenError extends Error {
  readonly code = "BACKUP_OPEN_FAILED";
  constructor() { super("BACKUP_OPEN_FAILED"); this.name = "EnvelopeOpenError"; }
}

export const envelopeInfo = (keyShareId: string, credentialId: string, generation: number) =>
  utf8(`kexify-escrow:v1:${keyShareId}:${credentialId}:${generation}`);

/** The plain key file + its generation as UTF-8 JSON (also the QR move plaintext). Wipe after use. */
export function keyFilePlaintext(k: KeyFileData, generation: number): Uint8Array {
  return utf8(JSON.stringify({
    id: k.id, peer: k.peer, share: k.share, publicKey: k.publicKey,
    eddsaShare: k.eddsaShare, eddsaPublicKey: k.eddsaPublicKey, type: k.type, shareGeneration: generation,
  } satisfies KeyFileData));
}

async function envelopeKey(secret: Uint8Array, peer: Uint8Array, epk: Uint8Array, recipientPub: Uint8Array, info: Uint8Array): Promise<CryptoKey> {
  const shared = x25519.getSharedSecret(secret, peer);
  const salt = new Uint8Array(64);
  salt.set(epk);
  salt.set(recipientPub, 32);
  try {
    const ikm = await crypto.subtle.importKey("raw", shared as BufferSource, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
      ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
    );
  } finally {
    wipe(shared);
  }
}

/** Is this served blob a v2 envelope? */
export function isEnvelopeV2(encryptedData: string): boolean {
  try { return (JSON.parse(encryptedData) as { mode?: string }).mode === ENVELOPE_V2_MODE; } catch { return false; }
}

/** Seal `keyFile` (generation `generation`) to the passkey `credentialId` whose escrow key is `recipientKey` (base64). */
export const sealEnvelopeV2 = (o: SealInput): Promise<string> =>
  sealEnvelopeV2With(o, newEphemeralKeyPair().secretKey, crypto.getRandomValues(new Uint8Array(12)));

type SealInput = { keyShareId: string; credentialId: string; generation: number; recipientKey: string; keyFile: KeyFileData };

/** sealEnvelopeV2 with a given ephemeral secret and IV: only for the cross-platform test vector. Wipes `ephSecret`. */
export async function sealEnvelopeV2With(o: SealInput, ephSecret: Uint8Array, iv: Uint8Array): Promise<string> {
  const eph = { secretKey: ephSecret, publicKey: x25519.getPublicKey(ephSecret) };
  const plain = keyFilePlaintext(o.keyFile, o.generation);
  try {
    const recipientPub = fromB64(o.recipientKey);
    if (recipientPub.length !== 32) throw new Error("bad escrow key");
    if (o.keyFile.id !== o.keyShareId) throw new Error("key file is for another wallet");
    const info = envelopeInfo(o.keyShareId, o.credentialId, o.generation);
    const key = await envelopeKey(eph.secretKey, recipientPub, eph.publicKey, recipientPub, info);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: info as BufferSource }, key, plain as BufferSource));
    const env: EnvelopeV2 = {
      mode: ENVELOPE_V2_MODE, v: 1, credentialId: o.credentialId, shareGeneration: o.generation,
      epk: b64(eph.publicKey), iv: b64(iv), ciphertext: b64(ct),
    };
    return JSON.stringify(env);
  } finally {
    wipe(eph.secretKey, plain);
  }
}

/**
 * Open a v2 envelope with the escrow secret of the passkey that made the ticket. Checks the envelope names that
 * passkey and generation, and that the key file is this wallet's. Any failure throws the same EnvelopeOpenError.
 */
export async function openEnvelopeV2(encryptedData: string, o: {
  keyShareId: string; generation: number; publicKey: string; escrowSecret: Uint8Array; credentialId?: string;
}): Promise<KeyFileData> {
  let plain: Uint8Array | null = null;
  try {
    const env = JSON.parse(encryptedData) as EnvelopeV2;
    if (env.mode !== ENVELOPE_V2_MODE || env.v !== 1 || env.shareGeneration !== o.generation) throw new EnvelopeOpenError();
    if (typeof env.credentialId !== "string" || (o.credentialId !== undefined && env.credentialId !== o.credentialId)) throw new EnvelopeOpenError();
    const epk = fromB64(env.epk);
    const iv = fromB64(env.iv);
    if (epk.length !== 32 || iv.length !== 12) throw new EnvelopeOpenError();
    const info = envelopeInfo(o.keyShareId, env.credentialId, env.shareGeneration);
    const key = await envelopeKey(o.escrowSecret, epk, epk, x25519.getPublicKey(o.escrowSecret), info);
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: info as BufferSource }, key, fromB64(env.ciphertext) as BufferSource));
    const data = JSON.parse(new TextDecoder().decode(plain)) as KeyFileData;
    const samePub = bytesEqual(utf8(String(data.publicKey ?? "").toLowerCase()), utf8(o.publicKey.toLowerCase()));
    if (data.id !== o.keyShareId || !samePub || (data.shareGeneration ?? -1) !== o.generation || !data.share) throw new EnvelopeOpenError();
    return data;
  } catch {
    throw new EnvelopeOpenError();
  } finally {
    wipe(plain);
  }
}
