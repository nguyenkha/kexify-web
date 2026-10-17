import { describe, expect, test } from "bun:test";
import { computeMaxSendable } from "./fee-helpers";
import type { Chain, Asset } from "../../lib/api";

const native = { symbol: "BCH", decimals: 8, isNative: true } as Asset;
const base = { balance: "1", feeLevel: "medium" as const, estimatedFeeWei: null, btcEstimatedFee: null, ltcEstimatedFee: null, bchEstimatedFee: null, xlmFeeRates: null };

describe("computeMaxSendable", () => {
  test("BCH subtracts the estimated fee", () => {
    expect(computeMaxSendable({ ...base, chain: { type: "bch" } as Chain, asset: native, bchEstimatedFee: 1000n })).toBe("0.99999");
  });

  test("quoted-fee native coin returns null until the fee is known", () => {
    for (const type of ["bch", "btc", "ltc", "evm", "xlm"]) {
      expect(computeMaxSendable({ ...base, chain: { type } as Chain, asset: native })).toBeNull();
    }
  });

  test("UTXO chains: what the largest coins cover (input cap) wins over balance - fee", () => {
    expect(computeMaxSendable({ ...base, chain: { type: "btc" } as Chain, asset: native, btcEstimatedFee: 1000n, utxoMaxSats: 61_234_500n })).toBe("0.612345");
  });

  test("tokens use the full balance", () => {
    expect(computeMaxSendable({ ...base, chain: { type: "evm" } as Chain, asset: { ...native, isNative: false } })).toBe("1");
  });
});
