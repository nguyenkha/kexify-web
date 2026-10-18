import { describe, expect, test } from "bun:test";
import { Transaction, Wallet } from "ethers";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58, base64 } from "@scure/base";
import { buildDecodedReview, decodedFacts, decodeRawTx, decodeWarnings, parseTxInput } from "./decode-raw-tx";
import { serializeForSigning } from "../chains/evmTx";
import { addressToScriptPubKey, computeTxid, serializeWitnessTx, type BtcUnsignedTx } from "../chains/btcTx";
import { bytesToHex, hexToBytes } from "../../shared/utils";

const wallet = new Wallet("0x" + "11".repeat(32));
const TO = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";

describe("EVM", () => {
  test("signed EIP-1559: fields, sender, hash", async () => {
    const raw = await wallet.signTransaction({
      type: 2, chainId: 11155111, nonce: 7, to: TO, value: 10n ** 16n, data: "0x",
      maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gasLimit: 21000n,
    });
    const d = decodeRawTx(raw);
    expect(d.kind).toBe("evm");
    if (d.kind !== "evm") return;
    expect(d.tx.type).toBe(2);
    expect(d.tx.chainId).toBe(11155111);
    expect(d.tx.nonce).toBe(7n);
    expect(d.tx.to).toBe(TO);
    expect(d.tx.value).toBe(10n ** 16n);
    expect(d.tx.signed).toBe(true);
    expect(d.tx.from).toBe(wallet.address);
    expect(d.tx.hash).toBe(Transaction.from(raw).hash!);
    expect(d.tx.maxFeeWei).toBe(21000n * 30_000_000_000n);
    const review = buildDecodedReview(d, { evmNativeSymbol: "ETH" });
    expect(review.hero.amount).toEqual({ text: "0.01 ETH", amount: true });
  });

  test("signed EIP-2930 with access list and legacy EIP-155", async () => {
    const t1 = await wallet.signTransaction({
      type: 1, chainId: 1, nonce: 0, to: TO, value: 1n, gasPrice: 5n, gasLimit: 50000n,
      accessList: [{ address: TO, storageKeys: ["0x" + "00".repeat(31) + "01"] }],
    });
    const d1 = decodeRawTx(t1);
    expect(d1.kind === "evm" && d1.tx.from).toBe(wallet.address);
    expect(d1.kind === "evm" && d1.tx.accessListSize).toBe(1);
    const t0 = await wallet.signTransaction({ type: 0, chainId: 8453, nonce: 3, to: TO, value: 2n, gasPrice: 9n, gasLimit: 21000n });
    const d0 = decodeRawTx(t0);
    expect(d0.kind === "evm" && d0.tx.chainId).toBe(8453);
    expect(d0.kind === "evm" && d0.tx.from).toBe(wallet.address);
  });

  test("unsigned EIP-155 payload as the wallet builds it, and ERC-20 transfer review", () => {
    const data = "0xa9059cbb" + TO.slice(2).toLowerCase().padStart(64, "0") + (5n * 10n ** 6n).toString(16).padStart(64, "0");
    const bytes = serializeForSigning({ nonce: 1n, gasPrice: 2n, gasLimit: 60000n, to: TO, value: 0n, data: hexToBytes(data), chainId: 1 });
    const d = decodeRawTx(bytesToHex(bytes));
    expect(d.kind === "evm" && d.tx.signed).toBe(false);
    expect(d.kind === "evm" && d.tx.chainId).toBe(1);
    const review = buildDecodedReview(d, { from: wallet.address });
    expect(review.hero.verb).toEqual({ key: "review.verb.send" });
  });

  test("unsigned EIP-1559 (ethers unsignedSerialized)", () => {
    const tx = Transaction.from({ type: 2, chainId: 10, nonce: 0, to: TO, value: 1n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, gasLimit: 21000n });
    const d = decodeRawTx(tx.unsignedSerialized);
    expect(d.kind === "evm" && d.tx.type).toBe(2);
    expect(d.kind === "evm" && d.tx.signed).toBe(false);
  });

  test("pre-EIP-155 signed tx is flagged replayable", async () => {
    const raw = await wallet.signTransaction({ type: 0, nonce: 0, to: TO, value: 1n, gasPrice: 1n, gasLimit: 21000n });
    const d = decodeRawTx(raw);
    expect(d.kind === "evm" && d.tx.chainId).toBe(null);
    expect(d.kind === "evm" && d.tx.from).toBe(wallet.address);
    expect(decodeWarnings(d)).toContain("expert.decode.warn.replayable");
  });

  test("tampered signed tx recovers another sender, truncated tx throws", async () => {
    const raw = await wallet.signTransaction({ type: 2, chainId: 1, nonce: 0, to: TO, value: 1n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, gasLimit: 21000n });
    expect(() => decodeRawTx(raw.slice(0, -4))).toThrow();
  });
});

describe("Solana", () => {
  test("signed and unsigned SOL transfer, base64 and base58", () => {
    const secret = new Uint8Array(32).fill(7);
    const from = ed25519.getPublicKey(secret);
    const to = new Uint8Array(32).fill(9);
    const system = new Uint8Array(32);
    const data = new Uint8Array(12);
    data[0] = 2;
    new DataView(data.buffer).setBigUint64(4, 1_000_000n, true);
    const msg = new Uint8Array([1, 0, 1, 3, ...from, ...to, ...system, ...new Uint8Array(32), 1, 2, 2, 0, 1, 12, ...data]);
    const unsigned = new Uint8Array([1, ...new Uint8Array(64), ...msg]);
    const u = decodeRawTx(base64.encode(unsigned));
    expect(u.kind).toBe("solana");
    expect(u.kind === "solana" && u.signatures).toBe("unsigned");
    const signed = new Uint8Array([1, ...ed25519.sign(msg, secret), ...msg]);
    const s = decodeRawTx(base58.encode(signed));
    expect(s.kind === "solana" && s.signatures).toBe("signed");
    expect(s.kind === "solana" && s.tx.from).toBe(base58.encode(from));
    expect(decodedFacts(s).find((f) => f.key === "expert.decode.fact.signed")?.valueKey).toBe("expert.decode.yes");
    expect(buildDecodedReview(s).hero.amount).toEqual({ text: "0.001 SOL", amount: true });
  });
});

describe("Solana signatures and encodings", () => {
  const secret = new Uint8Array(32).fill(7);
  const from = ed25519.getPublicKey(secret);
  const msgFor = (lamports: bigint) => {
    const data = new Uint8Array(12);
    data[0] = 2;
    new DataView(data.buffer).setBigUint64(4, lamports, true);
    return new Uint8Array([1, 0, 1, 3, ...from, ...new Uint8Array(32).fill(9), ...new Uint8Array(32), ...new Uint8Array(32), 1, 2, 2, 0, 1, 12, ...data]);
  };

  test("tampered message or junk signature = invalid, with a warning", () => {
    const msg = msgFor(1_000_000n);
    const sig = ed25519.sign(msg, secret);
    const tampered = new Uint8Array([1, ...sig, ...msgFor(9_000_000n)]);
    const d = decodeRawTx(base64.encode(tampered));
    expect(d.kind === "solana" && d.signatures).toBe("invalid");
    expect(decodeWarnings(d)).toContain("expert.decode.warn.badSignature");
    const junk = new Uint8Array([1, 1, ...new Uint8Array(63), ...msg]);
    expect((decodeRawTx(base64.encode(junk)) as { signatures: string }).signatures).toBe("invalid");
  });

  test("base58 text that is also valid base64 (length % 4 = 0) still decodes", () => {
    // Search a signed tx whose base58 text length is a multiple of 4 (then it also reads as base64): extra
    // read-only accounts change the length by ~44 chars each.
    let found = false;
    for (let extra = 0; extra < 12 && !found; extra++) {
      const base = msgFor(1_000_000n);
      const keys = base.slice(4, 4 + 96);
      const tail = base.slice(4 + 128);
      const pad = new Uint8Array(32 * extra).map((_, i) => (i % 32) + 20 + Math.floor(i / 32));
      const msg = new Uint8Array([1, 0, 1 + extra, 3 + extra + 1, ...keys, ...new Uint8Array(32), ...pad, ...base.slice(4 + 96, 4 + 128), ...tail]);
      const text = base58.encode(new Uint8Array([1, ...ed25519.sign(msg, secret), ...msg]));
      if (text.length % 4 !== 0) continue;
      found = true;
      expect(parseTxInput(text).length).toBe(2);
      const d = decodeRawTx(text);
      expect(d.kind === "solana" && d.signatures).toBe("signed");
    }
    expect(found).toBe(true);
  });
});

describe("Bitcoin family", () => {
  const spk = new Uint8Array([0x00, 0x14, ...new Uint8Array(20).fill(0x75)]);
  const tx: BtcUnsignedTx = {
    version: 2, locktime: 0,
    inputs: [{ txid: "aa".repeat(32), vout: 1, value: 50_000n, sequence: 0xfffffffd }],
    outputs: [{ value: 40_000n, scriptPubKey: spk }],
  };

  test("raw segwit tx: outputs, txid, signed", () => {
    const raw = serializeWitnessTx(tx, [[new Uint8Array(71), new Uint8Array(33)]]);
    const d = decodeRawTx(bytesToHex(raw));
    expect(d.kind).toBe("utxo");
    if (d.kind !== "utxo") return;
    expect(d.tx.txid).toBe(computeTxid(tx));
    expect(d.tx.outputs[0].address?.startsWith("bc1q")).toBe(true);
    expect(addressToScriptPubKey(d.tx.outputs[0].address!)).toEqual(spk);
    expect(d.tx.inputs[0].signed).toBe(true);
    expect(d.tx.fee).toBe(null);
    expect(buildDecodedReview(d).fee).toBeUndefined();
  });

  test("PSBT with witness_utxo: input amount and fee", () => {
    const unsignedRaw = hexToBytes(legacyNoWitness(tx));
    const varint = (n: number) => new Uint8Array([n]);
    const wu = new Uint8Array([...le64(50_000n), spk.length, ...spk]);
    const psbt = new Uint8Array([
      0x70, 0x73, 0x62, 0x74, 0xff,
      1, 0x00, ...varint(unsignedRaw.length), ...unsignedRaw, 0,
      1, 0x01, ...varint(wu.length), ...wu, 0,
      0,
    ]);
    const d = decodeRawTx(base64.encode(psbt));
    expect(d.kind === "utxo" && d.tx.format).toBe("psbt");
    expect(d.kind === "utxo" && d.tx.fee).toBe(10_000n);
    expect(d.kind === "utxo" && d.tx.inputs[0].signed).toBe(false);
    expect(buildDecodedReview(d).fee?.amount).toBe("0.0001 BTC");
  });

  test("LTC network picks the ltc address encoding", () => {
    const raw = serializeWitnessTx(tx, [[new Uint8Array(71), new Uint8Array(33)]]);
    const d = decodeRawTx(bytesToHex(raw), "ltc");
    expect(d.kind === "utxo" && d.tx.outputs[0].address?.startsWith("ltc1q")).toBe(true);
  });
});

test("input parsing rejects garbage", () => {
  expect(() => parseTxInput("   ")).toThrow();
  expect(() => decodeRawTx("zz-not-a-tx")).toThrow();
});

function le64(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

/** Version ‖ inputs (empty scriptSig) ‖ outputs ‖ locktime: the PSBT's unsigned tx. */
function legacyNoWitness(t: BtcUnsignedTx): string {
  const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const parts: number[] = [...u32(t.version), t.inputs.length];
  for (const i of t.inputs) parts.push(...hexToBytes(i.txid).reverse(), ...u32(i.vout), 0, ...u32(i.sequence));
  parts.push(t.outputs.length);
  for (const o of t.outputs) parts.push(...le64(o.value), o.scriptPubKey.length, ...o.scriptPubKey);
  parts.push(...u32(t.locktime));
  return bytesToHex(new Uint8Array(parts));
}
