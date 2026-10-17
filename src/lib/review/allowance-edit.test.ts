// Spending-cap editing: input parsing, re-encoding, and that the API policy reads the edited allowance from the
// bytes (the server's own parsers on the edited calldata / raw_data; needs api/node_modules like the TRON tests).
import { describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha256";
import { evmLegs } from "../../../../api/src/policy/evm-calldata";
import { parseTronRawData } from "../../../../api/src/chains/tron-raw-data-parser";
import { tronLeg } from "../../../../api/src/chains/tron-tx";
import { FROM, TO, USDT, rawData, trc20Call } from "../../../../api/src/chains/tron-test-fixtures";
import { bytesToHex, hexToBytes } from "../../shared/utils";
import { allowanceOptions, allowanceText, parseAllowanceInput, withEvmApproveAmount, withTronApproveAmount } from "./allowance-edit";
import { buildEvmTxReview } from "./build-evm-tx-review";
import { buildTronReview } from "./build-tron-review";
import { decodeTronRawData } from "../chains/tron-raw-data-decoder";

const SELF = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SPENDER = "0xdddddddddddddddddddddddddddddddddddddddd";
const approveData = (amount: string) => "0x095ea7b3" + SPENDER.slice(2).padStart(64, "0") + amount;
const MAX = 2n ** 256n - 1n;

describe("custom amount input", () => {
  test("decimals, separators, zero", () => {
    expect(parseAllowanceInput("1,250.5", 6)).toEqual({ amount: 1_250_500_000n });
    expect(parseAllowanceInput(" 0 ", 6)).toEqual({ amount: 0n });
    expect(parseAllowanceInput(".5", 2)).toEqual({ amount: 50n });
    expect(parseAllowanceInput("1.1234567", 6)).toEqual({ error: "tooManyDecimals" });
    expect(parseAllowanceInput("1e5", 6)).toEqual({ error: "invalid" });
    expect(parseAllowanceInput("-1", 6)).toEqual({ error: "invalid" });
    expect(parseAllowanceInput("", 6)).toEqual({ error: "empty" });
    expect(parseAllowanceInput("1" + "0".repeat(80), 0)).toEqual({ error: "tooLarge" });
  });
  test("custom cap text is read in the UI language", () => {
    expect(parseAllowanceInput("1.250,5", 6, "es")).toEqual({ amount: 1_250_500_000n });
    expect(parseAllowanceInput("0,5", 6, "es")).toEqual({ amount: 500_000n });
    expect(parseAllowanceInput("0,5", 6, "en")).toEqual({ amount: 500_000n });
    expect(parseAllowanceInput("1 250,5", 6, "ru")).toEqual({ amount: 1_250_500_000n });
    expect(parseAllowanceInput("1.250", 6, "es")).toEqual({ error: "ambiguous" });
    expect(parseAllowanceInput("1,250", 6, "en")).toEqual({ error: "ambiguous" });
    expect(parseAllowanceInput("1,250", 6, "es")).toEqual({ amount: 1_250_000n });
  });
  test("prefill text: unlimited starts empty", () => {
    expect(allowanceText(MAX, 6)).toBe("");
    expect(allowanceText(5_000_000n, 6)).toBe("5");
  });
});

describe("options", () => {
  test("unlimited request: balance option is recommended", () => {
    expect(allowanceOptions(MAX, 1_250_000_000n)).toEqual([
      { choice: "requested", amount: MAX, recommended: false },
      { choice: "balance", amount: 1_250_000_000n, recommended: true },
      { choice: "custom", recommended: false },
    ]);
  });
  test("no balance known: custom is recommended; a limited request recommends nothing", () => {
    expect(allowanceOptions(MAX, null).map((o) => [o.choice, o.recommended])).toEqual([["requested", false], ["custom", true]]);
    expect(allowanceOptions(10n, 1_000n).map((o) => o.choice)).toEqual(["requested", "custom"]);
  });
});

describe("EVM approve re-encoding", () => {
  test("rewrites only the amount word; the policy reads the edited amount", () => {
    const edited = withEvmApproveAmount(approveData("f".repeat(64)), 500_000_000n);
    expect(edited).toBe(approveData((500_000_000n).toString(16).padStart(64, "0")));
    expect(evmLegs(SELF, TOKEN, 0n, edited.slice(2))).toEqual([{ kind: "approval", spender: SPENDER, asset: { contract: TOKEN }, amount: 500_000_000n, standard: "erc20" }]);
  });
  test("zero is a revoke the policy sees as amount 0", () => {
    const edited = withEvmApproveAmount(approveData("f".repeat(64)), 0n);
    expect(evmLegs(SELF, TOKEN, 0n, edited.slice(2))[0]).toMatchObject({ kind: "approval", amount: 0n });
  });
  test("refuses anything but a plain approve", () => {
    expect(() => withEvmApproveAmount("0xa9059cbb" + "0".repeat(128), 1n)).toThrow();
    expect(() => withEvmApproveAmount(approveData("f".repeat(64)) + "00", 1n)).toThrow();
  });
  test("the review shows the edited cap, not the request", () => {
    const m = buildEvmTxReview({ tx: { to: TOKEN, data: approveData("f".repeat(64)) }, from: { address: SELF }, nativeSymbol: "ETH", token: { symbol: "USDC", decimals: 6 }, approveOverride: 500_000_000n, feeWei: 1n, prices: {} });
    expect(m.hero.amount).toEqual({ text: "500 USDC", amount: true });
    expect(m.warnings.map((w) => w.code)).toEqual(["approval"]);
  });
});

describe("TRC-20 approve re-encoding", () => {
  const tronTx = (amount: bigint) => {
    const raw = rawData(trc20Call(FROM, USDT, "095ea7b3", TO, amount));
    const hex = bytesToHex(raw);
    const data = bytesToHex(raw).match(/095ea7b3[0-9a-f]{128}/)![0];
    return { txID: bytesToHex(sha256(raw)), raw_data_hex: hex, raw_data: { contract: [{ parameter: { value: { data, owner_address: "41..", contract_address: "41.." } }, type: "TriggerSmartContract" }], expiration: 1 } };
  };

  test("raw_data_hex, JSON data and txID change together; the API parser reads the new amount", () => {
    const tx = tronTx(MAX);
    const edited = withTronApproveAmount(tx, 25_000_000n);
    expect(edited.raw_data_hex.length).toBe(tx.raw_data_hex.length);
    expect(edited.txID).toBe(bytesToHex(sha256(hexToBytes(edited.raw_data_hex))));
    expect(edited.raw_data.contract![0].parameter!.value!.data).toBe(edited.raw_data_hex.match(/095ea7b3[0-9a-f]{128}/)![0]);
    const parsed = parseTronRawData(hexToBytes(edited.raw_data_hex));
    expect(tronLeg(parsed)).toMatchObject({ kind: "approval", amount: 25_000_000n });
    expect(decodeTronRawData(hexToBytes(edited.raw_data_hex))).toMatchObject({ kind: "trc20_approve", to: TO, amount: 25_000_000n, unlimited: false });
    expect(edited.raw_data.expiration).toBe(1);
  });

  test("refuses a JSON view that does not match the bytes, and transfers", () => {
    const tx = tronTx(MAX);
    const lying = { ...tx, raw_data: { contract: [{ parameter: { value: { data: "095ea7b3" + "0".repeat(128) } } }] } };
    expect(() => withTronApproveAmount(lying, 1n)).toThrow();
    const raw = rawData(trc20Call(FROM, USDT, "a9059cbb", TO, 5n));
    expect(() => withTronApproveAmount({ txID: "", raw_data_hex: bytesToHex(raw), raw_data: {} }, 1n)).toThrow();
  });

  test("the review shows the edited cap", () => {
    const tx = withTronApproveAmount(tronTx(MAX), 25_000_000n);
    const m = buildTronReview({ decoded: decodeTronRawData(hexToBytes(tx.raw_data_hex)), from: { address: FROM }, token: { symbol: "USDT", decimals: 6 }, feeSun: 0n, prices: {} });
    expect(m.hero.amount).toEqual({ text: "25 USDT", amount: true });
    expect(m.warnings.map((w) => w.code)).toEqual(["approval"]);
  });
});
