// Rows of the signing progress, in the order and words of the iOS signing sheet
// (ios/.../Send/SigningSheet.swift, Scan/WCRequestSheet.swift).

import type { SigningPhase } from "../sendTypes";

type T = (key: string) => string;

/** The co-signing row: MPC with the server, or both shares in this browser in recovery mode. */
export function signRowLabel(t: T, recovery: boolean): string {
  return recovery ? t("send.localSigning") : t("send.mpcSigning");
}

/** A transaction: validating & signing → MPC signing → broadcast → confirming (sign-only stops after signing). */
export function txSigningSteps(t: T, signLabel: string, signOnly = false): { label: string }[] {
  const steps = [{ label: t("send.validatingAndSigning") }, { label: signLabel }];
  return signOnly ? steps : [...steps, { label: t("send.broadcasting") }, { label: t("send.confirming") }];
}

/** Which row a signing phase is on. */
export const TX_PHASE_STEP: Record<SigningPhase, number> = {
  "loading-keyshare": 0,
  "building-tx": 0,
  "mpc-signing": 1,
  "broadcasting": 2,
  "polling": 3,
};
