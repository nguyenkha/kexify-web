import { describe, expect, test } from "bun:test";
import { XLM_MIN_CREATE_ACCOUNT_STROOPS, xlmDestinationBlockKey, xlmDestinationVerdict } from "./xlm-destination";

const v = (destExists: boolean, destTrusts: boolean, isNative: boolean, amountStroops: bigint) =>
  xlmDestinationVerdict({ destExists, destTrusts, isNative, amountStroops });

describe("xlmDestinationVerdict", () => {
  test("XLM to an existing account is a payment, any amount", () => {
    expect(v(true, false, true, 1n)).toBe("payment");
  });
  test("XLM to a new account needs at least 1 XLM", () => {
    expect(XLM_MIN_CREATE_ACCOUNT_STROOPS).toBe(10_000_000n);
    expect(v(false, false, true, 10_000_000n)).toBe("createAccount");
    expect(v(false, false, true, 25_000_000n)).toBe("createAccount");
    expect(v(false, false, true, 9_999_999n)).toBe("belowMinimum");
    expect(v(false, false, true, 0n)).toBe("belowMinimum");
  });
  test("an issued asset needs an activated account with a trustline", () => {
    expect(v(false, false, false, 10_000_000_000n)).toBe("notActivated");
    expect(v(true, false, false, 1n)).toBe("noTrustline");
    expect(v(true, true, false, 1n)).toBe("payment");
  });
  test("only the refusals block", () => {
    expect(xlmDestinationBlockKey("payment")).toBeNull();
    expect(xlmDestinationBlockKey("createAccount")).toBeNull();
    expect(xlmDestinationBlockKey("belowMinimum")).toBe("send.xlmBelowMinimum");
    expect(xlmDestinationBlockKey("notActivated")).toBe("send.xlmDestNotActive");
    expect(xlmDestinationBlockKey("noTrustline")).toBe("send.xlmDestNoTrustline");
  });
});
