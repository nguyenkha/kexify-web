// tron_signTransaction → review model, read from the signed bytes (raw_data_hex) only.

import { formatSun } from "../chains/tronTx";
import type { TronDecodedTx } from "../chains/tron-raw-data-decoder";
import { allowanceOf, editedLabel } from "./build-evm-tx-review";
import { amountText, amountUsd, buildFee, buildTotal, fromRow, partyOf, policyWarnings, type AssetAmount } from "./review-common";
import { shortAddress, sortWarnings, UNLIMITED_THRESHOLD, warning } from "./review-format";
import type { NameLookup, PolicyCheckInput, Prices, ReviewHero, ReviewModel, ReviewRow, ReviewWarning, TokenInfo } from "./review-types";

export interface TronReviewInput {
  /** null when the bytes are not one TRX / TRC-20 transfer or TRC-20 approve (cannot be signed). */
  decoded: TronDecodedTx | null;
  from: { address: string; name?: string };
  /** Token metadata of `decoded.contractAddress`. */
  token?: TokenInfo;
  /** Estimated TRX burned (sun). */
  feeSun: bigint;
  prices: Prices;
  nameOf?: NameLookup;
  policy?: PolicyCheckInput | null;
  firstTimeRecipient?: boolean;
  raw?: string;
  /** TRC-20 approve: the cap the user edited (base units); the signed bytes are rewritten to it. */
  approveOverride?: bigint | null;
  tokenBalanceRaw?: bigint;
}

export function buildTronReview(i: TronReviewInput): ReviewModel {
  const d = i.decoded;
  const rows: ReviewRow[] = [fromRow(i.from)];
  const warnings: ReviewWarning[] = [...policyWarnings(i.policy)];
  if (!d) {
    return {
      hero: { icon: "warning", tone: "danger", verb: { key: "review.verb.unreadable" } },
      warnings: sortWarnings([...warnings, warning("unreadable", {}, true)]),
      rows,
      actions: [],
      raw: i.raw,
    };
  }
  const fee: AssetAmount = { raw: i.feeSun, decimals: 6, symbol: "TRX" };
  const outflow: AssetAmount[] = [];
  const contract = d.contractAddress ? partyOf(d.contractAddress, (a) => i.nameOf?.(a) ?? i.token?.symbol) : null;
  const symbol = i.token?.symbol ?? (d.contractAddress ? shortAddress(d.contractAddress) : "TRX");
  const tokenAmt: AssetAmount | null = d.kind !== "trx_transfer" && i.token ? { raw: d.amount, decimals: i.token.decimals, symbol } : null;
  let hero: ReviewHero;
  let allowance: ReviewModel["allowance"];

  if (d.kind === "trx_transfer") {
    const amt: AssetAmount = { raw: d.amount, decimals: 6, symbol: "TRX" };
    const party = partyOf(d.to, i.nameOf);
    hero = { icon: "send", tone: "accent", verb: { key: "review.verb.send" }, amount: { text: amountText(amt) }, usd: amountUsd(amt, i.prices), counterparty: { prefix: "to", party } };
    rows.push({ label: { key: "send.to" }, party, fullAddress: true });
    outflow.push(amt);
    if (i.firstTimeRecipient) warnings.push(warning("firstTimeRecipient"));
  } else if (d.kind === "trc20_transfer") {
    const party = partyOf(d.to, i.nameOf);
    hero = {
      icon: "send", tone: "accent", verb: { key: "review.verb.send" },
      amount: tokenAmt ? { text: amountText(tokenAmt) } : { key: "review.baseUnits", params: { amount: d.amount.toString(), symbol } },
      usd: tokenAmt ? amountUsd(tokenAmt, i.prices) : undefined,
      counterparty: { prefix: "to", party },
    };
    rows.push({ label: { key: "send.to" }, party, fullAddress: true });
    if (contract) rows.push({ label: { key: "review.token" }, party: contract });
    if (tokenAmt) outflow.push(tokenAmt);
    if (i.firstTimeRecipient) warnings.push(warning("firstTimeRecipient"));
  } else {
    const spender = partyOf(d.to, i.nameOf);
    const spenderName = spender.name ?? shortAddress(d.to);
    const cap = i.token ? (i.approveOverride ?? d.amount) : d.amount;
    const unlimited = cap >= UNLIMITED_THRESHOLD;
    const capAmt: AssetAmount | null = i.token ? { raw: cap, decimals: i.token.decimals, symbol } : null;
    const text = capAmt ? amountText(capAmt) : `${d.amount} ${symbol}`;
    if (i.token) allowance = allowanceOf(d.amount, cap, i.token, i.tokenBalanceRaw);
    if (!(cap === 0n && i.token)) {
      warnings.push(unlimited ? warning("unlimitedApproval", { spender: spenderName, symbol }) : warning("approval", { spender: spenderName, amount: text }));
    }
    hero = {
      icon: "approve", tone: "warning", verb: { key: cap === 0n && i.token ? "review.verb.revoke" : "review.verb.approve" },
      amount: unlimited ? { key: "review.unlimited", params: { symbol } } : { text },
      usd: !unlimited && capAmt ? amountUsd(capAmt, i.prices) : undefined,
      sub: i.token && cap !== d.amount ? editedLabel(d.amount, i.token) : undefined,
      counterparty: { prefix: "for", party: spender },
    };
    rows.push({ label: { key: "review.spender" }, party: spender, fullAddress: true });
    if (contract) rows.push({ label: { key: "review.token" }, party: contract });
  }
  // The signed cap on TRX burned: always visible, not only in fee details.
  if (d.feeLimit > 0n) rows.push({ label: { key: "review.fee.limit" }, value: { text: `${formatSun(d.feeLimit)} TRX` } });

  return {
    hero,
    warnings: sortWarnings(warnings),
    rows,
    actions: [],
    fee: { ...buildFee(fee, i.prices), approx: true },
    total: buildTotal([...outflow, fee], i.prices),
    raw: i.raw,
    allowance,
  };
}
