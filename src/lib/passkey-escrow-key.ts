// Escrow key of a passkey (phase 4b): an X25519 key pair derived from the passkey's SECOND PRF output, so the
// signing device can seal the wallet TO any passkey (its public half sits on the server) without that passkey.
// priv = HKDF-SHA256(ikm = PRF second output, salt = "kexify-escrow:v1", info = "x25519", 32 bytes). Same on iOS.
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesEqual, fromB64, utf8 } from "./device-move/move-codec";
import { wipe } from "./secret-bytes";

/** Second PRF salt of every assertion (the first stays PRF_SALT). */
export const ESCROW_SALT = utf8("kexify-escrow:v1");

const view = (src: BufferSource) =>
  src instanceof ArrayBuffer ? new Uint8Array(src) : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);

/** Best effort: zero the PRF output the browser handed back. */
export function wipePrfOutput(src: BufferSource | undefined): void {
  if (!src) return;
  try { wipe(view(src)); } catch { /* detached or read-only */ }
}

/** The 32-byte X25519 secret of the passkey whose second PRF output is `prfSecond` (wipe it after use). */
export async function escrowSecretFromPrf(prfSecond: BufferSource): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", view(prfSecond) as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: ESCROW_SALT as BufferSource, info: utf8("x25519") as BufferSource }, ikm, 256,
  );
  return new Uint8Array(bits);
}

export const escrowPublicKey = (secret: Uint8Array): Uint8Array => x25519.getPublicKey(secret);

// Passkeys this tab asserted WITH PRF, with the escrow PUBLIC key derived here (it also went to the server in the
// same call). Only these may be allowed to restore a wallet silently, and only when the server's key for them is
// exactly this one; any other passkey needs the visible prompt. Memory only: a reload forgets.
const assertedHere = new Map<string, Uint8Array>();

export function noteEscrowPasskey(credentialId: string, escrowPublic: Uint8Array): void { assertedHere.set(credentialId, escrowPublic.slice()); }
export function passkeyAssertedHere(credentialId: string): boolean { return assertedHere.has(credentialId); }

/**
 * Does the server's escrow key for a passkey this tab asserted equal the one derived here, byte for byte? false for
 * any other passkey or an unreadable key. A mismatch means someone else pinned a key for it: never wrap to it.
 */
export function ownEscrowKeyMatches(credentialId: string, serverKeyB64: string): boolean {
  const mine = assertedHere.get(credentialId);
  if (!mine) return false;
  try { return bytesEqual(mine, fromB64(serverKeyB64)); } catch { return false; }
}
