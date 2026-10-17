// View model for every review / signing screen (UX spec: docs/ux/review-and-sign.md).
// Pure data: text is i18n keys + params so web (react-i18next) and iOS (same keys in
// Localizable.xcstrings, via the JSC bundle) render the same model.

/** Localisable text: a catalog key with string params, or literal text (amounts, symbols, addresses). */
/** `amount: true`: text the builder made from an amount ("1234.5 ETH"), safe to show in the user's number format.
 *  Plain text without it (a dApp's domain name, a message line) is shown exactly as received. */
export type Label = { key: string; params?: Record<string, string> } | { text: string; amount?: true };

export type Tone = "danger" | "warning";

/** Warning codes in display order (see WARNING_ORDER). */
export type WarningCode =
  | "policyBlocked"
  | "riskyAddress"
  | "unreadable"
  | "signHash"
  | "accountControl"
  | "nftApprovalForAll"
  | "riskyAction"
  | "unlimitedApproval"
  | "approval"
  | "unknownProgram"
  | "firstTimeRecipient"
  | "mayFail"
  | "wrongNetwork"
  | "feeCap";

export interface ReviewWarning {
  code: WarningCode;
  tone: Tone;
  /** true = Confirm is disabled while this warning stands. */
  blocks: boolean;
  /** Params for `review.warn.<code>.title/body` (policyBlocked: `leg`). */
  params: Record<string, string>;
}

export interface ReviewParty {
  address: string;
  /** Address-book label or known-contract name. Never shown without the address. */
  name?: string;
}

export type HeroIcon = "send" | "approve" | "contract" | "stack" | "sign" | "warning";
export type HeroTone = "accent" | "warning" | "danger";

export interface ReviewHero {
  icon: HeroIcon;
  tone: HeroTone;
  verb: Label;
  /** Large line: "0.25 ETH", "Unlimited USDC", "Sign in to app.uniswap.org". */
  amount?: Label;
  /** Fiat value of `amount` when priced. */
  usd?: number;
  /** Small line under the amount (balance at risk, "No network fee · no funds move"). */
  sub?: Label;
  /** "to Alice · 0x3fC9…7FAD" / "for Permit2 · 0x0000…8BA3". */
  counterparty?: { prefix: "to" | "for"; party: ReviewParty };
  /** "No network fee · no funds move" pill (message signatures). */
  noFundsMove?: boolean;
}

export interface ReviewRow {
  label: Label;
  value?: Label;
  /** Date value as epoch seconds; the UI formats it in the user's locale. */
  date?: number;
  /** Muted second line under the value (fiat, symbol). */
  sub?: Label;
  party?: ReviewParty;
  /** Main counterparty: full address in groups of 4 (anti address-poisoning). Else short + expand. */
  fullAddress?: boolean;
}

export type ActionIcon = "send" | "approve" | "authority" | "close" | "create" | "memo" | "program" | "token" | "unknown";

export interface ReviewAction {
  icon: ActionIcon;
  /** Tint the icon when the action raised a warning, so the user can find it. */
  tone?: Tone;
  title: Label;
  party?: { prefix: "to" | "for" | "account" | "program"; party: ReviewParty };
  detail?: Label;
}

export interface ReviewFee {
  /** Native amount with symbol, e.g. "0.00042 ETH" ("≈" is added by the UI when `approx`). */
  amount?: string;
  approx?: boolean;
  usd?: number;
  loading?: boolean;
  /** Solana: a compute-unit price is set. */
  inclPriority?: boolean;
  /** "Fee details" disclosure rows (compute units, base fee, rent, fee limit). */
  details?: ReviewRow[];
}

export interface ReviewTotal {
  /** Fiat sum of everything that leaves the wallet + fee; absent when any part is unpriced. */
  usd?: number;
  /** Single-asset total in that asset ("0.25042 ETH"). */
  native?: string;
  /** Native parts joined with " + " when there is more than one asset. */
  parts: string[];
}

export interface ReviewModel {
  hero: ReviewHero;
  warnings: ReviewWarning[];
  rows: ReviewRow[];
  /** Every real action (Solana instructions minus compute budget, TRON / EVM legs). */
  actions: ReviewAction[];
  fee?: ReviewFee;
  /** Message signatures: "No network fee to sign" instead of a fee. */
  noFee?: "message" | "signature";
  total?: ReviewTotal;
  /** Full message text for message signatures. */
  message?: string;
  /** Raw data for the collapsed disclosure (calldata, typed-data JSON, base64 tx). */
  raw?: string;
  /** The approval's cap can be edited (ERC-20 / TRC-20 approve of a known token): what the editor needs. */
  allowance?: ReviewAllowance;
  /** Permit / Permit2: the signature binds the amount, so it cannot be edited (the UI says why). */
  permitFixed?: boolean;
  /**
   * A second, explicit confirm before signing: "nftApprovalForAll" = the request lets someone move
   * every NFT of a collection (setApprovalForAll / PermitForAll). The policy allows it per action.
   */
  extraConfirm?: "nftApprovalForAll";
}

export interface ReviewAllowance {
  /** What the dApp asked for, base units as a decimal string (JSON-safe). */
  requested: string;
  /** The cap the review shows now (= requested unless edited). */
  current: string;
  decimals: number;
  symbol: string;
  /** Current token balance in base units, when known. */
  balance?: string;
  edited: boolean;
}

/** Advisory policy pre-check result (POST /api/keys/:id/rules/check). */
export interface PolicyCheckInput {
  allowed: boolean;
  blockedLeg?: string | null;
  fraudCheck?: { flagged: boolean } | null;
}

/** USD price by symbol (lib/prices.ts). */
export type Prices = Record<string, number>;

/** Token metadata by lower-cased contract / mint address. */
export type TokenInfo = { symbol: string; decimals: number };
export type TokenLookup = (address: string) => TokenInfo | undefined;

/** Address-book or known-contract name for an address. */
export type NameLookup = (address: string) => string | undefined;
