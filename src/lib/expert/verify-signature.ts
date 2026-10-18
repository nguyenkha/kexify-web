// Expert "Verify signature": EIP-191 personal_sign, EIP-712 typed data (EVM, recovers the signer) and
// Solana signMessage (ed25519, checks against the given address). Shared by web and iOS (chain bundle).
// Read-only. Smart-contract wallets (EIP-1271) are not checked: their signatures need an RPC call.

import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";
import { hashTypedData } from "../../../../api/src/eip712-hash";
import { bytesToHex, hexToBytes } from "../../shared/utils";
import { checksumEvmAddress } from "../review/review-format";

export type SignatureScheme = "eip191" | "eip712" | "solana";

export interface VerifyResult {
  /** Recovered EVM signer; for Solana the address the signature was checked against. */
  signer: string | null;
  /** Signer equals the expected address (case-insensitive for EVM). null = no expected address given. */
  match: boolean | null;
  /** Solana: the ed25519 signature is valid for `signer`. EVM: always true once a signer is recovered. */
  valid: boolean;
}

const isHex = (s: string) => /^0x([0-9a-fA-F]{2})*$/.test(s);

function strictHex(s: string): Uint8Array {
  const h = s.trim().replace(/^0x/i, "");
  if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new Error("Invalid hex");
  return hexToBytes(h);
}

/** personal_sign input: a 0x-hex string is the raw bytes (as wallets pass it), anything else is UTF-8 text. */
export function messageBytes(message: string): Uint8Array {
  return isHex(message) && message.length > 2 ? hexToBytes(message.slice(2)) : new TextEncoder().encode(message);
}

export function eip191Hash(message: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${message.length}`);
  return keccak_256(new Uint8Array([...prefix, ...message]));
}

/** r ‖ s ‖ v, v = 27/28 or 0/1 (EIP-2098 64-byte compact signatures too). */
function parseEvmSignature(sig: string): { r: bigint; s: bigint; recovery: number } {
  const b = strictHex(sig);
  const big = (x: Uint8Array) => BigInt(`0x${bytesToHex(x) || "0"}`);
  if (b.length === 65) {
    const v = b[64];
    const recovery = v >= 27 ? v - 27 : v;
    if (recovery !== 0 && recovery !== 1) throw new Error("Invalid signature: bad v");
    return { r: big(b.slice(0, 32)), s: big(b.slice(32, 64)), recovery };
  }
  if (b.length === 64) {
    const vs = b.slice(32);
    const recovery = vs[0] >> 7;
    vs[0] &= 0x7f;
    return { r: big(b.slice(0, 32)), s: big(vs), recovery };
  }
  throw new Error("Invalid signature: expected 65 bytes (r, s, v)");
}

function recoverEvmSigner(digest: Uint8Array, sig: string): string {
  const { r, s, recovery } = parseEvmSignature(sig);
  const pub = new secp256k1.Signature(r, s).addRecoveryBit(recovery).recoverPublicKey(digest).toBytes(false);
  return checksumEvmAddress(`0x${bytesToHex(keccak_256(pub.slice(1)).slice(12))}`);
}

/** Signature as hex, base58 (Phantom / Solana CLI) or base64. */
function parseEd25519Signature(sig: string): Uint8Array {
  const s = sig.trim();
  const tries = [() => strictHex(s), () => base58.decode(s), () => base64.decode(s)];
  for (const t of tries) {
    try {
      const b = t();
      if (b.length === 64) return b;
    } catch {
      /* next encoding */
    }
  }
  throw new Error("Invalid signature: expected 64 bytes (hex, base58 or base64)");
}

/** `message`: text / 0x-hex (EIP-191, Solana) or the typed-data JSON (EIP-712). */
export function verifySignature(scheme: SignatureScheme, message: string, signature: string, expected: string): VerifyResult {
  const want = expected.trim();
  if (scheme === "solana") {
    if (!want) throw new Error("Enter the Solana address that signed");
    const pub = base58.decode(want);
    if (pub.length !== 32) throw new Error("Invalid Solana address");
    const valid = ed25519.verify(parseEd25519Signature(signature), messageBytes(message), pub);
    return { signer: want, match: valid, valid };
  }
  const digest = scheme === "eip191" ? eip191Hash(messageBytes(message)) : hashTypedData(message);
  const signer = recoverEvmSigner(digest, signature);
  return { signer, match: want ? signer.toLowerCase() === want.toLowerCase() : null, valid: true };
}
