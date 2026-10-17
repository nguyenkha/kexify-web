import { describe, expect, test } from "bun:test";
import { signRowLabel, txSigningSteps, TX_PHASE_STEP } from "./signing-steps";

const t = (k: string) => k;

describe("signing steps (iOS SigningSheet order)", () => {
  test("validating & signing → MPC signing → broadcast → confirming", () => {
    expect(txSigningSteps(t, signRowLabel(t, false)).map((s) => s.label))
      .toEqual(["send.validatingAndSigning", "send.mpcSigning", "send.broadcasting", "send.confirming"]);
  });

  test("sign-only stops after signing; recovery signs locally", () => {
    expect(txSigningSteps(t, signRowLabel(t, true), true).map((s) => s.label))
      .toEqual(["send.validatingAndSigning", "send.localSigning"]);
  });

  test("building the transaction is part of the first row, as on iOS", () => {
    expect(TX_PHASE_STEP["building-tx"]).toBe(0);
    expect(TX_PHASE_STEP["mpc-signing"]).toBe(1);
    expect(TX_PHASE_STEP.polling).toBe(3);
  });
});
