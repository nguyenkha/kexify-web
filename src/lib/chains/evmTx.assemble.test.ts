import { describe, expect, test } from "bun:test";
import { SigningKey, Transaction, computeAddress } from "ethers";
import { assembleSignedTx, hashForSigning, recoverV, type UnsignedTx } from "./evmTx";

// Fixed test key (not a real wallet)
const PRIV = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
const key = new SigningKey(PRIV);
const FROM = computeAddress(key.publicKey);
const PUB = Uint8Array.from(Buffer.from(key.publicKey.slice(2), "hex"));

function baseTx(nonce: bigint, data = new Uint8Array(0)): UnsignedTx {
  return {
    nonce,
    gasPrice: 20_000_000_000n,
    gasLimit: 21_000n,
    to: "0x3535353535353535353535353535353535353535",
    value: 1_000_000_000_000_000_000n,
    data,
    chainId: 1,
  };
}

function sign(tx: UnsignedTx) {
  const hash = hashForSigning(tx);
  const sig = key.sign(hash);
  const r = BigInt(sig.r);
  const s = BigInt(sig.s);
  return { hash, r, s, recoveryBit: recoverV(hash, r, s, PUB) };
}

/** Search nonces until the signature component matches (deterministic RFC 6979, ~256 tries). */
function findTx(pred: (r: bigint, s: bigint) => boolean): UnsignedTx {
  for (let n = 0n; n < 20_000n; n++) {
    const tx = baseTx(n);
    const { r, s } = sign(tx);
    if (pred(r, s)) return tx;
  }
  throw new Error("no matching signature found");
}

const LEADING_ZERO = 1n << 248n; // value < 2^248 → top byte of the 32-byte form is 0x00

function checkRoundTrip(tx: UnsignedTx) {
  const { r, s, recoveryBit } = sign(tx);
  const signed = assembleSignedTx(tx, r, s, recoveryBit);
  const parsed = Transaction.from(signed.rawTransaction);
  expect(parsed.type).toBe(0);
  expect(parsed.from).toBe(FROM);
  expect(parsed.hash).toBe(signed.hash);
  expect(BigInt(parsed.signature!.r)).toBe(r);
  expect(BigInt(parsed.signature!.s)).toBe(s);
  // Byte-for-byte equal to ethers' canonical serialization (golden cross-check)
  const ref = Transaction.from({
    type: 0,
    nonce: Number(tx.nonce),
    gasPrice: tx.gasPrice,
    gasLimit: tx.gasLimit,
    to: tx.to,
    value: tx.value,
    data: "0x" + Buffer.from(tx.data).toString("hex"),
    chainId: tx.chainId,
    signature: parsed.signature,
  });
  expect(signed.rawTransaction).toBe(ref.serialized);
  return signed;
}

describe("assembleSignedTx (legacy EIP-155)", () => {
  test("ordinary signature round-trips to the sender", () => {
    checkRoundTrip(baseTx(0n));
  });

  test("ERC-20 call data round-trips", () => {
    const data = Uint8Array.from(Buffer.from("a9059cbb" + "00".repeat(12) + "35".repeat(20) + "00".repeat(31) + "01", "hex"));
    checkRoundTrip(baseTx(7n, data));
  });

  test("r with a leading zero byte is encoded minimally", () => {
    const tx = findTx((r) => r < LEADING_ZERO);
    const { r } = sign(tx);
    const signed = checkRoundTrip(tx);
    const rHex = r.toString(16).padStart(64, "0");
    // r is 31 bytes or fewer: RLP prefix 0x9f (0x80 + 31) or shorter, never a 0xa0 00.. prefix
    expect(signed.rawTransaction).not.toContain("a0" + rHex);
    expect(signed.rawTransaction).toContain(r.toString(16).padStart(62, "0"));
  });

  test("s with a leading zero byte is encoded minimally", () => {
    const tx = findTx((_r, s) => s < LEADING_ZERO);
    const { s } = sign(tx);
    const signed = checkRoundTrip(tx);
    expect(signed.rawTransaction).not.toContain("a0" + s.toString(16).padStart(64, "0"));
    expect(signed.rawTransaction.endsWith(s.toString(16).padStart(62, "0"))).toBe(true);
  });

  test("full 32-byte r/s keep their 0xa0 prefix", () => {
    const tx = findTx((r, s) => r >= LEADING_ZERO && s >= LEADING_ZERO);
    const { r, s } = sign(tx);
    const signed = checkRoundTrip(tx);
    expect(signed.rawTransaction).toContain("a0" + r.toString(16).padStart(64, "0"));
    expect(signed.rawTransaction.endsWith("a0" + s.toString(16).padStart(64, "0"))).toBe(true);
  });
});
