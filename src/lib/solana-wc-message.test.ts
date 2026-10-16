import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { decodeSolanaMessageParam, encodeSolanaSignature } from "./solana-wc-message";

describe("solana_signMessage base58 encoding", () => {
  test("known vector: base58 'StV1DL6CwTryKyV' is 'hello world'", () => {
    const bytes = decodeSolanaMessageParam("StV1DL6CwTryKyV");
    expect(new TextDecoder().decode(bytes)).toBe("hello world");
    expect(base58.encode(bytes)).toBe("StV1DL6CwTryKyV");
  });

  test("a base64 message is not silently accepted as base58", () => {
    // '0', 'O', 'I', 'l', '+', '/' are outside the base58 alphabet
    expect(() => decodeSolanaMessageParam("aGVsbG8gd29ybGQ=")).toThrow();
  });

  test("signature round-trips through base58 and verifies under the account pubkey", () => {
    const secret = new Uint8Array(32).fill(7);
    const pub = ed25519.getPublicKey(secret);
    const msg = decodeSolanaMessageParam("StV1DL6CwTryKyV");
    const sigB58 = encodeSolanaSignature(ed25519.sign(msg, secret));
    expect(base58.decode(sigB58)).toHaveLength(64);
    expect(ed25519.verify(base58.decode(sigB58), msg, pub)).toBe(true);
  });
});
