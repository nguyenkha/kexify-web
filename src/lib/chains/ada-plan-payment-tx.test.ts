import { describe, expect, test } from "bun:test";
import { eddsaPubKeyToAdaAddress, planAdaPaymentTx, type CardanoUtxo } from "./adaTx";

// Preprod-like protocol params (minFeeA 44, minFeeB 155381, 1 ADA minimum output)
const PARAMS = { minFeeA: 44, minFeeB: 155_381, minUtxoValue: 1_000_000n };
const FROM = eddsaPubKeyToAdaAddress("11".repeat(32), true);
const TO = eddsaPubKeyToAdaAddress("22".repeat(32), true);
const ADA = 1_000_000n;

function utxo(i: number, lovelace: bigint): CardanoUtxo {
  return { txHash: i.toString(16).padStart(64, "0"), txIndex: 0, value: lovelace.toString() };
}

describe("planAdaPaymentTx change and fee", () => {
  test("never leaves a change output below the minimum UTXO value", () => {
    // 2.25 ADA in, 2 ADA out: ~0.08 ADA left after the fee, too small for an output
    const total = 2_250_000n;
    const { fee } = planAdaPaymentTx([utxo(1, total)], 1000, FROM, TO, 2n * ADA, PARAMS);
    const change = total - 2n * ADA - fee;
    expect(change === 0n || change >= PARAMS.minUtxoValue).toBe(true);
    expect(fee).toBeLessThan(300_000n);
  });

  test("refuses rather than burning sub-minimum change as a large fee", () => {
    // 2.9 ADA in, 2 ADA out: ~0.73 ADA change is below 1 ADA; absorbing it would be a ~0.9 ADA fee
    expect(() => planAdaPaymentTx([utxo(1, 2_900_000n)], 1000, FROM, TO, 2n * ADA, PARAMS)).toThrow(/minimum/i);
  });

  test("adds another UTXO so the change output is valid", () => {
    // Largest UTXO alone (2.5 ADA) leaves ~0.33 ADA change; with the 1.2 ADA one the change is a valid output
    const utxos = [utxo(1, 2_500_000n), utxo(2, 1_200_000n)];
    const { txBody, fee } = planAdaPaymentTx(utxos, 1000, FROM, TO, 2n * ADA, PARAMS);
    // Body = CBOR map { 0: inputs, ... }: byte 2 is the inputs array header (0x82 = 2 inputs)
    expect(txBody[2]).toBe(0x82);
    expect(3_700_000n - 2n * ADA - fee).toBeGreaterThanOrEqual(PARAMS.minUtxoValue);
    expect(fee).toBeLessThan(300_000n);
  });

  test("keeps normal sends unchanged", () => {
    const { fee } = planAdaPaymentTx([utxo(1, 10n * ADA)], 1000, FROM, TO, 2n * ADA, PARAMS);
    expect(fee).toBeGreaterThan(155_381n);
    expect(fee).toBeLessThan(300_000n);
  });
});
