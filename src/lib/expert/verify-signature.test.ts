import { describe, expect, test } from "bun:test";
import { Signature, Wallet } from "ethers";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";
import { verifySignature } from "./verify-signature";
import { bytesToHex } from "../../shared/utils";

const wallet = new Wallet("0x" + "22".repeat(32));
const other = new Wallet("0x" + "33".repeat(32));

describe("EIP-191", () => {
  test("text message: recovers and matches (any case)", async () => {
    const sig = await wallet.signMessage("hello kexify");
    const r = verifySignature("eip191", "hello kexify", sig, wallet.address.toLowerCase());
    expect(r.signer).toBe(wallet.address);
    expect(r.match).toBe(true);
  });

  test("0x-hex message is the raw bytes; v as 0/1 and EIP-2098 compact also work", async () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const sig = await wallet.signMessage(bytes);
    expect(verifySignature("eip191", "0xdeadbeef", sig, wallet.address).match).toBe(true);
    const s = Signature.from(sig);
    const v01 = s.r + s.s.slice(2) + (s.v - 27).toString(16).padStart(2, "0");
    expect(verifySignature("eip191", "0xdeadbeef", v01, wallet.address).match).toBe(true);
    expect(verifySignature("eip191", "0xdeadbeef", s.compactSerialized, wallet.address).match).toBe(true);
  });

  test("wrong signer = no match; no expected address = null", async () => {
    const sig = await other.signMessage("hi");
    expect(verifySignature("eip191", "hi", sig, wallet.address).match).toBe(false);
    expect(verifySignature("eip191", "hi", sig, "").match).toBe(null);
  });

  test("garbage signature throws", () => {
    expect(() => verifySignature("eip191", "hi", "0xzz", wallet.address)).toThrow();
    expect(() => verifySignature("eip191", "hi", "0x1234", wallet.address)).toThrow();
  });
});

describe("EIP-712", () => {
  test("typed data JSON: recovers the signer", async () => {
    const domain = { name: "Kexify", version: "1", chainId: 1, verifyingContract: "0x" + "cc".repeat(20) };
    const types = { Mail: [{ name: "to", type: "address" }, { name: "contents", type: "string" }] };
    const message = { to: other.address, contents: "gm" };
    const sig = await wallet.signTypedData(domain, types, message);
    const json = JSON.stringify({
      domain, primaryType: "Mail", message,
      types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...types },
    });
    const r = verifySignature("eip712", json, sig, wallet.address);
    expect(r.signer).toBe(wallet.address);
    expect(r.match).toBe(true);
  });
});

describe("Solana signMessage", () => {
  const secret = new Uint8Array(32).fill(5);
  const address = base58.encode(ed25519.getPublicKey(secret));
  const msg = "Sign in to kexify";
  const sig = ed25519.sign(new TextEncoder().encode(msg), secret);

  test("base58, base64 and hex signatures verify", () => {
    for (const s of [base58.encode(sig), base64.encode(sig), bytesToHex(sig)]) {
      expect(verifySignature("solana", msg, s, address)).toEqual({ signer: address, match: true, valid: true });
    }
  });

  test("other message or address fails", () => {
    expect(verifySignature("solana", msg + "!", base58.encode(sig), address).match).toBe(false);
    const otherAddr = base58.encode(ed25519.getPublicKey(new Uint8Array(32).fill(6)));
    expect(verifySignature("solana", msg, base58.encode(sig), otherAddr).valid).toBe(false);
    expect(() => verifySignature("solana", msg, base58.encode(sig), "")).toThrow();
  });
});
