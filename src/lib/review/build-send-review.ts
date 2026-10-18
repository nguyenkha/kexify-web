// Send flow → review model (Send → Review step, every chain). Same layout as WalletConnect.

import { parseUnits } from "../chains/evmTx";
import { amountLabel, buildTotal, fromRow, partyOf, policyWarnings, type AssetAmount } from "./review-common";
import { shortAddress, sortWarnings, usdOf, warning } from "./review-format";
import { findLookalike } from "./lookalike-address";
import type { NameLookup, PolicyCheckInput, Prices, ReviewModel, ReviewParty, ReviewRow, ReviewWarning } from "./review-types";

export interface SendReviewInput {
  asset: { symbol: string; decimals: number; isNative: boolean; contractAddress?: string | null };
  /** Amount as typed (decimal string). */
  amount: string;
  to: string;
  from: { address: string; name?: string };
  /** Network fee in the native asset; null while estimating. */
  fee: { amount: string; symbol: string; decimals: number; usd?: number | null } | null;
  /** Fiat values the send form already computed (prices by symbol are the fallback). */
  amountUsd?: number | null;
  prices: Prices;
  nameOf?: NameLookup;
  policy?: PolicyCheckInput | null;
  firstTimeRecipient?: boolean;
  /** Addresses the user knows on this chain (address book, recent, history, own): the lookalike check. */
  knownAddresses?: ReviewParty[];
  gasEstimateFailed?: boolean;
  /** XRP destination tag / XLM / TON memo. */
  memo?: { labelKey: string; value: string } | null;
}

const toBase = (amount: string, decimals: number): bigint => {
  try {
    return parseUnits(amount, decimals);
  } catch {
    return 0n;
  }
};

export function buildSendReview(i: SendReviewInput): ReviewModel {
  const amt: AssetAmount = { raw: toBase(i.amount, i.asset.decimals), decimals: i.asset.decimals, symbol: i.asset.symbol };
  const party = partyOf(i.to, i.nameOf);
  const warnings: ReviewWarning[] = [...policyWarnings(i.policy)];
  const lookalike = findLookalike(i.to, i.knownAddresses ?? []);
  if (lookalike) {
    const short = shortAddress(lookalike.address);
    warnings.push(warning("lookalikeAddress", { known: lookalike.name ? `${lookalike.name} (${short})` : short }));
  } else if (i.firstTimeRecipient) {
    warnings.push(warning("firstTimeRecipient"));
  }
  if (i.gasEstimateFailed) warnings.push(warning("mayFail"));

  const rows: ReviewRow[] = [fromRow(i.from), { label: { key: "send.to" }, party, fullAddress: true }];
  if (!i.asset.isNative && i.asset.contractAddress) {
    rows.push({ label: { key: "review.token" }, party: partyOf(i.asset.contractAddress, () => i.asset.symbol) });
  }
  if (i.memo?.value) rows.push({ label: { key: i.memo.labelKey }, value: { text: i.memo.value } });

  // "< 0.000001" style fee strings parse to nothing: the fee then stays out of the native total.
  const feeAmt: AssetAmount | null = i.fee && /^\d+(\.\d+)?$/.test(i.fee.amount)
    ? { raw: toBase(i.fee.amount, i.fee.decimals), decimals: i.fee.decimals, symbol: i.fee.symbol }
    : null;
  const amountUsd = i.amountUsd ?? usdOf(i.amount, i.asset.symbol, i.prices);
  const total = buildTotal(feeAmt ? [amt, feeAmt] : [amt], i.prices);
  // Prefer the form's own fiat numbers (same source the form showed) when given.
  const feeUsd = i.fee?.usd ?? (feeAmt ? usdOf(i.fee!.amount, i.fee!.symbol, i.prices) : undefined);
  if (amountUsd != null && (feeUsd != null || !feeAmt)) total.usd = amountUsd + (feeUsd ?? 0);

  return {
    hero: { icon: "send", tone: "accent", verb: { key: "review.verb.send" }, amount: amountLabel(amt, amt.decimals), usd: amountUsd ?? undefined, counterparty: { prefix: "to", party } },
    warnings: sortWarnings(warnings),
    rows,
    actions: [],
    fee: i.fee ? { amount: `${i.fee.amount} ${i.fee.symbol}`, usd: feeUsd ?? undefined } : { loading: true },
    total,
  };
}
