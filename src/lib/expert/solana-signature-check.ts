// Solana wire tx: check every required signature against the message and its signer keys (ed25519), so the
// decoder never calls a tampered or half-signed tx "signed". Read-only.

import { ed25519 } from "@noble/curves/ed25519.js";

export type SolanaSignatureState = "unsigned" | "partial" | "signed" | "invalid";

function compactU16(b: Uint8Array, o: number): { value: number; next: number } {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const x = b[o + i];
    if (x === undefined) throw new Error("Truncated");
    value |= (x & 0x7f) << (7 * i);
    if (!(x & 0x80)) return { value, next: o + i + 1 };
  }
  throw new Error("Bad compact-u16");
}

export function solanaSignatureState(wire: Uint8Array): SolanaSignatureState {
  const { value: n, next } = compactU16(wire, 0);
  const msg = wire.slice(next + n * 64);
  const h = msg[0] & 0x80 ? 1 : 0; // versioned message: prefix byte, then the same header
  const required = msg[h];
  const keys = compactU16(msg, h + 3);
  if (required !== n || keys.value < n) return "invalid";
  let present = 0;
  for (let i = 0; i < n; i++) {
    const sig = wire.slice(next + i * 64, next + (i + 1) * 64);
    if (sig.every((x) => x === 0)) continue;
    const key = msg.slice(keys.next + i * 32, keys.next + (i + 1) * 32);
    if (!ed25519.verify(sig, msg, key)) return "invalid";
    present++;
  }
  return present === 0 ? "unsigned" : present === n ? "signed" : "partial";
}
