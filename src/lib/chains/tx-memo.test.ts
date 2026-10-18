import { describe, expect, test } from "bun:test";
import { xlmTxMemo, xrpTxMemo } from "./tx-memo";

// Same cases as iOS KexifyCoreTests/HistoryMemoTests.swift.
describe("xlmTxMemo", () => {
  test("text, id, hash", () => {
    expect(xlmTxMemo({ transaction: { memo_type: "text", memo: "chatpay:Terissa" } })).toEqual({ kind: "memo", value: "chatpay:Terissa" });
    expect(xlmTxMemo({ transaction: { memo_type: "id", memo: "18446744073709551615" } })?.value).toBe("18446744073709551615");
    expect(xlmTxMemo({ transaction: { memo_type: "hash", memo: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=" } })?.value)
      .toBe("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  });
  test("none, empty, not joined", () => {
    expect(xlmTxMemo({ transaction: { memo_type: "none" } })).toBeUndefined();
    expect(xlmTxMemo({ transaction: { memo_type: "text", memo: "" } })).toBeUndefined();
    expect(xlmTxMemo({})).toBeUndefined();
  });
});

describe("xrpTxMemo", () => {
  test("destination tag", () => {
    expect(xrpTxMemo({ TransactionType: "Payment", DestinationTag: 4294967295, SourceTag: 7 })).toEqual({ kind: "destinationTag", value: "4294967295" });
    expect(xrpTxMemo({ DestinationTag: 0 })?.value).toBe("0");
    expect(xrpTxMemo({ TransactionType: "Payment" })).toBeUndefined();
  });
});
