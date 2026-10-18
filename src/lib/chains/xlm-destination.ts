// What a Stellar send does to its destination, decided before signing (sign-xlm.ts, the review step, and iOS
// StellarAsset.destination, which must agree with this file's tests).
//
// - XLM to an account that does not exist yet is a CREATE_ACCOUNT: it needs at least the network's minimum starting
//   balance (2 base reserves = 1 XLM), else Stellar rejects it on-chain (op_low_reserve) after the fee is taken.
// - Any other asset needs an existing account that trusts it (a trustline), else Stellar rejects it.

/** 1 XLM in stroops: 2 × the 0.5 XLM base reserve (unchanged since protocol 11). */
export const XLM_MIN_CREATE_ACCOUNT_STROOPS = 10_000_000n;

export type XlmDestinationVerdict =
  | "payment"          // the account exists (and trusts the asset): a plain payment
  | "createAccount"    // XLM to a new account, enough to open it
  | "belowMinimum"     // XLM to a new account, less than 1 XLM: blocked
  | "notActivated"     // an issued asset to an account that does not exist: blocked
  | "noTrustline";     // an issued asset to an account without its trustline: blocked

export function xlmDestinationVerdict(p: {
  destExists: boolean;
  /** Issued asset only: the destination has a trustline for it. */
  destTrusts: boolean;
  isNative: boolean;
  amountStroops: bigint;
}): XlmDestinationVerdict {
  if (p.isNative) {
    if (p.destExists) return "payment";
    return p.amountStroops >= XLM_MIN_CREATE_ACCOUNT_STROOPS ? "createAccount" : "belowMinimum";
  }
  if (!p.destExists) return "notActivated";
  return p.destTrusts ? "payment" : "noTrustline";
}

/** The i18n key of a verdict that blocks signing, else null. */
export function xlmDestinationBlockKey(v: XlmDestinationVerdict): string | null {
  switch (v) {
    case "belowMinimum": return "send.xlmBelowMinimum";
    case "notActivated": return "send.xlmDestNotActive";
    case "noTrustline": return "send.xlmDestNoTrustline";
    default: return null;
  }
}
