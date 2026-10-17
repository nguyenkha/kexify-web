import { describe, expect, test } from "bun:test";
import * as btc from "./btcTx";
import * as ltc from "./ltcTx";
import * as bch from "./bchTx";
import { MAX_TX_INPUTS, TooManyInputsError } from "./utxo-input-cap";
import { publicKeyToLtcSegwitAddress } from "./ltcAdapter";

/** n confirmed coins of 10_000..(10_000 + n - 1) sats, smallest first (selection sorts them). */
const coins = (n: number, confirmed = true): btc.UTXO[] =>
  Array.from({ length: n }, (_, i) => ({ txid: i.toString(16).padStart(64, "0"), vout: 0, value: 10_000 + i, status: { confirmed } }));
const sum = (u: { value: number }[]) => u.reduce((s, x) => s + BigInt(x.value), 0n);
const TO = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const FROM = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const RATE = 2;

function thrown(f: () => unknown): unknown {
  try { f(); } catch (e) { return e; }
  throw new Error("did not throw");
}

describe("BTC / LTC coin selection stops at MAX_TX_INPUTS", () => {
  test("an amount the 50 largest coins cover selects at most 50", () => {
    const u = coins(60);
    const { selected } = btc.selectUtxos(u, 400_000n, RATE, "p2wpkh", false, TO, FROM, MAX_TX_INPUTS);
    expect(selected.length).toBeLessThanOrEqual(MAX_TX_INPUTS);
    expect(selected[0].value).toBe(10_059); // largest first
  });

  test("more than 50 needed: TooManyInputsError carries what the 50 largest can send (Max), which then builds exactly", () => {
    const u = coins(60);
    const e = thrown(() => btc.buildBtcTransaction(TO, sum(u) - 10_000n, u, RATE, FROM, "p2wpkh", true, false, MAX_TX_INPUTS));
    expect(e).toBeInstanceOf(TooManyInputsError);
    const err = e as TooManyInputsError;
    expect(err.max).toBe(50);
    expect(err.message).toBe(`TOO_MANY_INPUTS max=50 cover=${err.coverSats}`); // parsed by the iOS app

    const max = btc.maxSendableSats(u, RATE, "p2wpkh", MAX_TX_INPUTS, TO);
    expect(max).toEqual({ sats: err.coverSats, inputs: 50, capped: true });
    const top50 = sum([...u].sort((a, b) => b.value - a.value).slice(0, 50));
    expect(max.sats).toBe(top50 - btc.estimateFee(50, RATE, false, "p2wpkh", TO));

    const tx = btc.buildBtcTransaction(TO, max.sats, u, RATE, FROM, "p2wpkh", true, false, MAX_TX_INPUTS);
    expect(tx.inputs).toHaveLength(50);
    expect(tx.outputs).toHaveLength(1); // no change: Max sends it all
    expect(() => btc.buildBtcTransaction(TO, max.sats + 1n, u, RATE, FROM, "p2wpkh", true, false, MAX_TX_INPUTS)).toThrow(TooManyInputsError);
  });

  test("review: coins worth less than their input fee are left out of Max", () => {
    const u: btc.UTXO[] = [{ txid: "f".repeat(64), vout: 0, value: 10_000, status: { confirmed: true } },
      ...Array.from({ length: 50 }, (_, i) => ({ txid: i.toString(16).padStart(64, "0"), vout: 1, value: 1, status: { confirmed: true } }))];
    const max = btc.maxSendableSats(u, 10, "p2wpkh", MAX_TX_INPUTS, TO);
    expect(max.inputs).toBe(1);
    expect(max.sats).toBe(10_000n - btc.estimateFee(1, 10, false, "p2wpkh", TO));
    const tx = btc.buildBtcTransaction(TO, max.sats, u, 10, FROM, "p2wpkh", true, false, MAX_TX_INPUTS);
    expect(tx.inputs).toHaveLength(1);
  });

  test("no cap (recovery mode signs locally): all 60 coins can be spent", () => {
    const u = coins(60);
    const all = btc.maxSendableSats(u, RATE, "p2wpkh", Infinity, TO);
    expect(all).toMatchObject({ inputs: 60, capped: false });
    expect(btc.buildBtcTransaction(TO, all.sats, u, RATE, FROM).inputs).toHaveLength(60);
  });

  test("manually selected coins over the cap are refused", () => {
    expect(() => btc.selectUtxos(coins(51), 1000n, RATE, "p2wpkh", true, TO, FROM, MAX_TX_INPUTS)).toThrow(TooManyInputsError);
    expect(btc.selectUtxos(coins(50), 1000n, RATE, "p2wpkh", true, TO, FROM, MAX_TX_INPUTS).selected).toHaveLength(50);
  });

  test("50 coins or fewer that are not enough: still the plain insufficient-funds error", () => {
    const e = thrown(() => btc.selectUtxos(coins(50), 10_000_000n, RATE, "p2wpkh", false, TO, FROM, MAX_TX_INPUTS));
    expect(e).not.toBeInstanceOf(TooManyInputsError);
  });

  test("LTC builds through the same capped selection", () => {
    const u = coins(55);
    const max = ltc.maxSendableSats(u, RATE, "p2wpkh", MAX_TX_INPUTS);
    expect(max.capped).toBe(true);
    const G = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const from = publicKeyToLtcSegwitAddress(G, false);
    const tx = ltc.buildLtcTransaction(from, max.sats, u, RATE, from, "p2wpkh", true, false, MAX_TX_INPUTS);
    expect(tx.inputs).toHaveLength(50);
  });
});

describe("BCH coin selection stops at MAX_TX_INPUTS", () => {
  const BCH_TO = "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
  const BCH_FROM = "bitcoincash:qr95sy3j9xwd2ap32xkykttr4cvcu7as4y0qverfuy";

  test("Max = the 50 largest minus the 50-input fee, and it builds with one output", () => {
    const u = coins(70, false); // 0-conf only: BCH spends unconfirmed when nothing is confirmed
    const max = bch.maxSendableSats(u, 1, MAX_TX_INPUTS);
    expect(max.capped).toBe(true);
    const e = thrown(() => bch.buildBchTransaction(BCH_TO, max.sats + 1n, u, 1, BCH_FROM, false, MAX_TX_INPUTS));
    expect((e as TooManyInputsError).coverSats).toBe(max.sats);
    const tx = bch.buildBchTransaction(BCH_TO, max.sats, u, 1, BCH_FROM, false, MAX_TX_INPUTS);
    expect(tx.inputs).toHaveLength(50);
    expect(tx.outputs).toHaveLength(1);
  });
});
