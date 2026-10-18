import { afterEach, describe, expect, test } from "bun:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import * as doge from "./dogeTx";
import { publicKeyToDogeAddress } from "./dogeAdapter";
import { MAX_TX_INPUTS, TooManyInputsError } from "./utxo-input-cap";
import { bytesToHex } from "../../shared/utils";

// Private key 1: its compressed key hashes to 751e76e8...3bd6, a classic vector (cross-checked with a Python base58check).
const G_PUB = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const FROM = "DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE";
const P2SH = "A37YDYSwz3438rFtm1SLVcQHyD7JeueC9H";
const TO = "DGuWvcwkRVurx6uS96ygKQuNkb1orZE9BF";
const COIN = 100_000_000;
const RATE = doge.DOGE_MIN_FEE_RATE; // 0.01 DOGE/kB
const coin = (i: number, value: number, confirmed = true): doge.UTXO =>
  ({ txid: i.toString(16).padStart(64, "a"), vout: 0, value, status: confirmed ? { confirmed: true, block_height: 1 } : { confirmed: false } });

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("DOGE addresses", () => {
  test("P2PKH 0x1e from the key; P2PKH and P2SH pay; other coins' and SegWit addresses are refused", () => {
    expect(publicKeyToDogeAddress(G_PUB)).toBe(FROM);
    expect(bytesToHex(doge.addressToScriptPubKey(FROM))).toBe("76a914751e76e8199196d454941c45d1b3a323f1433bd688ac");
    expect(bytesToHex(doge.addressToScriptPubKey(P2SH))).toBe("a914751e76e8199196d454941c45d1b3a323f1433bd687");
    for (const a of ["1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH", "LVuDpNCSSj6pQ7t9Pv6d6sUkLKoqDEVUnJ", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLF", ""]) {
      expect(doge.isValidDogeAddress(a)).toBe(false);
    }
  });
});

describe("DOGE tx building", () => {
  test("version 1, final sequences (no RBF), change back to the sender", () => {
    const tx = doge.buildDogeTransaction(TO, 10n * BigInt(COIN), [coin(1, 100 * COIN)], RATE, FROM);
    expect(tx.version).toBe(1);
    expect(tx.inputs.every((i) => i.sequence === 0xffffffff)).toBe(true);
    expect(tx.outputs).toHaveLength(2);
    expect(bytesToHex(tx.outputs[1].scriptPubKey)).toBe(bytesToHex(doge.addressToScriptPubKey(FROM)));
    const fee = 100n * BigInt(COIN) - tx.outputs.reduce((s, o) => s + o.value, 0n);
    expect(fee).toBe(doge.estimateDogeFee(1, RATE, true)); // 226 B at 1000 sat/B
    expect(fee).toBe(226_000n);
  });

  test("change below 0.01 DOGE is folded into the fee (no dust output)", () => {
    const need = 10n * BigInt(COIN) + doge.estimateDogeFee(1, RATE, true);
    const tx = doge.buildDogeTransaction(TO, 10n * BigInt(COIN), [coin(1, Number(need + doge.DOGE_DUST_SATS - 1n))], RATE, FROM);
    expect(tx.outputs).toHaveLength(1);
    const kept = doge.buildDogeTransaction(TO, 10n * BigInt(COIN), [coin(1, Number(need + doge.DOGE_DUST_SATS))], RATE, FROM);
    expect(kept.outputs[1].value).toBe(doge.DOGE_DUST_SATS);
  });

  test("below-dust amounts, out-of-range fee rates and non-DOGE recipients are refused", () => {
    const u = [coin(1, 100 * COIN)];
    expect(() => doge.buildDogeTransaction(TO, doge.DOGE_DUST_SATS - 1n, u, RATE, FROM)).toThrow("DOGE_BELOW_DUST");
    expect(() => doge.buildDogeTransaction(TO, BigInt(COIN), u, RATE - 1, FROM)).toThrow("fee rate");
    expect(() => doge.buildDogeTransaction(TO, BigInt(COIN), u, doge.DOGE_MAX_FEE_RATE + 1, FROM)).toThrow("fee rate");
    expect(() => doge.buildDogeTransaction("1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH", BigInt(COIN), u, RATE, FROM)).toThrow();
  });

  test("unconfirmed coins are not spent; the 50-input cap holds and Max builds exactly", () => {
    expect(() => doge.buildDogeTransaction(TO, BigInt(COIN), [coin(1, 100 * COIN, false)], RATE, FROM)).toThrow("Insufficient");
    const many = Array.from({ length: 60 }, (_, i) => coin(i, COIN + i));
    let err: unknown;
    try { doge.buildDogeTransaction(TO, 59n * BigInt(COIN), many, RATE, FROM, false, MAX_TX_INPUTS); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TooManyInputsError);
    const max = doge.maxSendableSats(many, RATE, MAX_TX_INPUTS, TO);
    expect(max.inputs).toBe(MAX_TX_INPUTS);
    expect((err as TooManyInputsError).coverSats).toBe(max.sats);
    const tx = doge.buildDogeTransaction(TO, max.sats, many, RATE, FROM, false, MAX_TX_INPUTS);
    expect(tx.inputs).toHaveLength(MAX_TX_INPUTS);
    expect(tx.outputs).toHaveLength(1);
  });

  test("signed with the legacy sighash, the serialized tx carries a signature that verifies for each input", () => {
    const priv = new Uint8Array(32); priv[31] = 1;
    const tx = doge.buildDogeTransaction(TO, 5n * BigInt(COIN), [coin(1, 3 * COIN), coin(2, 4 * COIN)], RATE, FROM);
    const pub = doge.getCompressedPublicKey(G_PUB);
    const pkh = doge.pubKeyHash(pub);
    const sigs = tx.inputs.map((_, i) => {
      const h = doge.legacySighash(tx, i, pkh);
      const sig = secp256k1.sign(h, priv, { prehash: false, format: "recovered" });
      const { r, s } = secp256k1.Signature.fromBytes(sig.slice(1), "compact");
      expect(secp256k1.verify(secp256k1.Signature.fromBytes(sig.slice(1), "compact").toBytes("compact"), h, pub, { prehash: false })).toBe(true);
      return doge.makeP2PKHScriptSig(r, s, pub);
    });
    const raw = bytesToHex(doge.serializeLegacyTx(tx, sigs));
    expect(raw.startsWith("01000000" + "02")).toBe(true); // version 1, two inputs, no SegWit marker
    expect(doge.computeLegacyTxid(tx, sigs)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("DOGE public reads", () => {
  test("coin strings parse exactly; anything else throws", () => {
    expect(doge.coinToSats("9.51727163")).toBe(951727163n);
    expect(doge.coinToSats("62221")).toBe(6222100000000n);
    for (const v of ["1.123456789", "-1", "1e3", "", 5, null]) expect(() => doge.coinToSats(v)).toThrow();
  });

  test("fee rate: BlockCypher's medium per-kB quote, clamped; the wallet default on any failure", async () => {
    const quote = (body: unknown, status = 200) => { globalThis.fetch = (async () => Response.json(body, { status })) as unknown as typeof fetch; };
    quote({ low_fee_per_kb: 44_505_952 });
    expect(await doge.fetchDogeFeeRate()).toBe(44_506);
    quote({ low_fee_per_kb: 10 });
    expect(await doge.fetchDogeFeeRate()).toBe(doge.DOGE_MIN_FEE_RATE);
    quote({ low_fee_per_kb: 9e12 });
    expect(await doge.fetchDogeFeeRate()).toBe(doge.DOGE_MAX_FEE_RATE);
    quote({ error: "Limits reached." }, 429);
    expect(await doge.fetchDogeFeeRate()).toBe(doge.DOGE_MIN_FEE_RATE);
  });

  test("Blockchair UTXOs: unconfirmed flagged; a cut list throws so the caller falls back", async () => {
    const answer = (utxo: unknown[], count: number) => {
      globalThis.fetch = (async () => Response.json({ data: { [TO]: { address: { unspent_output_count: count }, utxo } } })) as unknown as typeof fetch;
    };
    const u = { transaction_hash: "ab".repeat(32), index: 1, value: 1000000, block_id: 6420000 };
    answer([u, { ...u, index: 2, block_id: -1 }], 2);
    expect(await doge.fetchUtxos(TO)).toEqual([
      { txid: "ab".repeat(32), vout: 1, value: 1000000, status: { confirmed: true, block_height: 6420000 } },
      { txid: "ab".repeat(32), vout: 2, value: 1000000, status: { confirmed: false } },
    ]);
    answer([u], 2);
    await expect(doge.fetchUtxos(TO)).rejects.toThrow("cut");
    globalThis.fetch = (async () => Response.json({ data: { [TO]: { address: {}, utxo: [u] } } })) as unknown as typeof fetch;
    await expect(doge.fetchUtxos(TO)).rejects.toThrow("cut"); // no count: cannot tell the list is whole
  });

  test("UTXOs: BlockCypher when Blockchair fails or cuts; its cut list and bad rows throw", async () => {
    const h = "cd".repeat(32);
    const cypher = (body: Record<string, unknown>) => {
      globalThis.fetch = (async (u: string) => new URL(u).host === "api.blockchair.com"
        ? new Response("busy", { status: 430 })
        : Response.json({ address: TO, ...body })) as unknown as typeof fetch;
    };
    cypher({ txrefs: [{ tx_hash: h, tx_output_n: 0, value: 2000000, block_height: 6420001 }],
      unconfirmed_txrefs: [{ tx_hash: h, tx_output_n: 3, value: 5000000, block_height: -1 }] });
    expect(await doge.fetchUtxos(TO)).toEqual([
      { txid: h, vout: 0, value: 2000000, status: { confirmed: true, block_height: 6420001 } },
      { txid: h, vout: 3, value: 5000000, status: { confirmed: false } },
    ]);
    cypher({});
    expect(await doge.fetchUtxos(TO)).toEqual([]); // no txrefs: an empty wallet
    cypher({ txrefs: [], hasMore: true });
    await expect(doge.fetchUtxos(TO)).rejects.toThrow("HTTP 430"); // both failed: the first error
    cypher({ txrefs: [], unconfirmed_txrefs: [{ tx_hash: h, tx_input_n: 0, tx_output_n: -1, value: 1, block_height: -1 }] });
    expect(await doge.fetchUtxos(TO)).toEqual([]); // a pending spend's input ref is not a coin
    cypher({ txrefs: [{ tx_hash: h, tx_output_n: 0, value: -5, block_height: 1 }] });
    await expect(doge.fetchUtxos(TO)).rejects.toThrow("HTTP 430");
  });

  test("broadcast: Blockchair's node verdict is final; no answer goes on to BlockCypher; duplicates are success", async () => {
    const raw = "0100000000" + "00" + "00000000"; // 0 inputs, 0 outputs: only its txid matters here
    const txid = (await import("./ltc-blockbook")).rawTxid(raw);
    const calls: string[] = [];
    const route = (bc: () => Response, cy: () => Response) => {
      globalThis.fetch = (async (u: string) => { calls.push(new URL(u).host); return new URL(u).host === "api.blockchair.com" ? bc() : cy(); }) as unknown as typeof fetch;
    };
    route(() => Response.json({ data: { transaction_hash: txid } }), () => { throw new Error("not reached"); });
    expect(await doge.broadcastDogeTx(raw)).toBe(txid);
    route(() => Response.json({ data: null, context: { error: "Invalid transaction. Error: min relay fee not met" } }, { status: 400 }), () => new Response("ok"));
    await expect(doge.broadcastDogeTx(raw)).rejects.toThrow("min relay fee");
    calls.length = 0;
    route(() => new Response("bad gateway", { status: 502 }), () => new Response(JSON.stringify({ tx: { hash: txid } }), { status: 201 }));
    expect(await doge.broadcastDogeTx(raw)).toBe(txid);
    expect(calls).toEqual(["api.blockchair.com", "api.blockcypher.com"]);
    route(() => Response.json({ context: { error: "Invalid transaction. Error: txn-already-in-mempool" } }, { status: 400 }), () => new Response("x", { status: 500 }));
    expect(await doge.broadcastDogeTx(raw)).toBe(txid);
    // BlockCypher's text for a tx it already has (measured 2026-10-18).
    route(() => new Response("timeout", { status: 504 }), () => new Response(JSON.stringify({ error: `Error validating transaction: Transaction with hash ${txid} already exists..` }), { status: 400 }));
    expect(await doge.broadcastDogeTx(raw)).toBe(txid);
  });
});
