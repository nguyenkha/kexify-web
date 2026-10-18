// Address book sync, crypto layer (plans/261018-1308-address-book-sync/plan.md).
// Mirrored byte for byte by ios/KexifyCore/Sources/KexifyCore/AddressBookSyncCrypto.swift.
//
//   KEK  = HKDF-SHA256(UTF-8 client ECDSA share string, salt "kexify-address-book-v1", info "kek:<keyShareId>", 32)
//   wrap = iv12 || AES-256-GCM(KEK, ABK, aad "kexify-ab-wrap-v1:<sub>:<keyShareId>") || tag16
//   ct   = iv12 || AES-256-GCM(ABK, pad(json), aad "kexify-ab-v1:<sub>") || tag16
//   pad(json) = u32be(len) || json || zeros up to a multiple of 1024 bytes

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { wipe } from "./secret-bytes";

export const ENVELOPE_VERSION = 1;
const PAD_BLOCK = 1024;
const IV_BYTES = 12;
const enc = new TextEncoder();

// Local base64 (standard alphabet, padded) so this module stays free of the MPC/WASM imports.
const toBase64 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Envelope {
  v: number;
  wraps: Record<string, string>;
  ct: string;
}

/** KEK for one wallet. The caller wipes the result when done. */
export function deriveKek(ecdsaShare: string, keyShareId: string): Uint8Array {
  const ikm = enc.encode(ecdsaShare);
  try {
    return deriveKekFromAscii(ikm, keyShareId);
  } finally {
    wipe(ikm);
  }
}

/** Same KEK from the share string's bytes (base64 is ASCII, so they equal its UTF-8), for paths that never make the string. */
export function deriveKekFromAscii(shareAscii: Uint8Array, keyShareId: string): Uint8Array {
  return hkdf(sha256, shareAscii, "kexify-address-book-v1", `kek:${keyShareId}`, 32);
}

export function newAbk(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(key: Uint8Array, plain: Uint8Array, aad: string, iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))): Promise<Uint8Array> {
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(aad) }, await aesKey(key), plain as BufferSource));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return out;
}

/** Throws on a wrong key, wrong AAD or tampered bytes (GCM tag). */
async function open(key: Uint8Array, sealed: Uint8Array, aad: string): Promise<Uint8Array> {
  if (sealed.length < IV_BYTES + 16) throw new Error("sealed box too short");
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.slice(0, IV_BYTES), additionalData: enc.encode(aad) },
    await aesKey(key), sealed.slice(IV_BYTES)));
}

const wrapAad = (sub: string, keyShareId: string) => `kexify-ab-wrap-v1:${sub}:${keyShareId}`;
const bodyAad = (sub: string) => `kexify-ab-v1:${sub}`;

export async function wrapAbk(kek: Uint8Array, abk: Uint8Array, sub: string, keyShareId: string): Promise<string> {
  return toBase64(await seal(kek, abk, wrapAad(sub, keyShareId)));
}

export async function unwrapAbk(kek: Uint8Array, wrap: string, sub: string, keyShareId: string): Promise<Uint8Array> {
  const abk = await open(kek, fromBase64(wrap), wrapAad(sub, keyShareId));
  if (abk.length !== 32) { wipe(abk); throw new Error("bad key length"); }
  return abk;
}

export function pad(json: string): Uint8Array {
  const body = enc.encode(json);
  const total = Math.max(PAD_BLOCK, Math.ceil((4 + body.length) / PAD_BLOCK) * PAD_BLOCK);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(body, 4);
  return out;
}

export function unpad(bytes: Uint8Array): string {
  if (bytes.length < 4) throw new Error("padded body too short");
  const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  if (len > bytes.length - 4) throw new Error("bad padded length");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + len));
}

export async function sealBody(abk: Uint8Array, json: string, sub: string): Promise<string> {
  return toBase64(await seal(abk, pad(json), bodyAad(sub)));
}

export async function openBody(abk: Uint8Array, ct: string, sub: string): Promise<string> {
  return unpad(await open(abk, fromBase64(ct), bodyAad(sub)));
}

export function parseEnvelope(blob: string): Envelope {
  const e = JSON.parse(blob) as Partial<Envelope>;
  if (e?.v !== ENVELOPE_VERSION) throw new Error(`unsupported address book envelope v${String(e?.v)}`);
  if (typeof e.ct !== "string" || !e.wraps || typeof e.wraps !== "object" || Array.isArray(e.wraps)) throw new Error("malformed envelope");
  const wraps: Record<string, string> = {};
  for (const [k, w] of Object.entries(e.wraps)) if (typeof w === "string") wraps[k] = w;
  return { v: e.v, wraps, ct: e.ct };
}

export function encodeEnvelope(wraps: Record<string, string>, ct: string): string {
  return JSON.stringify({ v: ENVELOPE_VERSION, wraps, ct });
}

/** Test hook: a fixed IV, so web and Swift tests can share vectors. Never used by the app. */
export const __test = { seal, open, wrapAad, bodyAad };
