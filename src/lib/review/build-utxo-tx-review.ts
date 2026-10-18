// Decoded Bitcoin-family tx (raw or PSBT) → review model: every output with its amount, the inputs,
// and the fee when every input amount is known (a PSBT with UTXO data). Used by the Expert decoder.

import { amountLabel, buildFee, buildTotal, type AssetAmount } from "./review-common";
import { shortAddress } from "./review-format";
import type { Prices, ReviewModel, ReviewRow } from "./review-types";
import type { DecodedUtxoTx } from "../expert/utxo-raw-tx-decode";

const SATS_DECIMALS = 8;

export function buildUtxoTxReview(tx: DecodedUtxoTx, symbol: string, prices: Prices): ReviewModel {
  const amt = (raw: bigint): AssetAmount => ({ raw, decimals: SATS_DECIMALS, symbol });
  const sent = tx.outputs.reduce((s, o) => s + o.value, 0n);
  const rows: ReviewRow[] = [];
  tx.outputs.forEach((o, i) => {
    const n = String(i + 1);
    rows.push(o.address
      ? { label: { key: "expert.decode.outputN", params: { n } }, party: { address: o.address }, sub: amountLabel(amt(o.value)) }
      : { label: { key: "expert.decode.outputN", params: { n } }, value: amountLabel(amt(o.value)), sub: { text: `script ${o.script}` } });
  });
  tx.inputs.forEach((i, k) => {
    rows.push({
      label: { key: "expert.decode.inputN", params: { n: String(k + 1) } },
      value: { text: `${shortAddress(i.txid)}:${i.vout}` },
      sub: i.value !== undefined ? amountLabel(amt(i.value)) : i.address ? { text: i.address } : undefined,
    });
  });
  const fee = tx.fee != null && tx.fee >= 0n ? amt(tx.fee) : null;
  const only = tx.outputs.length === 1 ? tx.outputs[0] : undefined;
  return {
    hero: {
      icon: "send", tone: "accent", verb: { key: "review.verb.send" }, amount: amountLabel(amt(sent)),
      counterparty: only?.address ? { prefix: "to", party: { address: only.address } } : undefined,
    },
    warnings: [],
    rows,
    actions: [],
    // Unknown input amounts: no fee rather than a guess.
    fee: fee ? buildFee(fee, prices) : undefined,
    total: fee ? buildTotal([amt(sent), fee], prices) : undefined,
  };
}
