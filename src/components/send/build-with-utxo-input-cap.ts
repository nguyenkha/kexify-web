// Builds a BTC / LTC / BCH tx under the server's input cap (none in recovery mode: both shares sign
// locally). An amount that needs more inputs fails with what the largest coins can send in one tx.
import { MAX_TX_INPUTS, TooManyInputsError } from "../../lib/chains/utxo-input-cap";
import { formatUnits } from "../../lib/review/review-format";
import { isRecoveryMode } from "../../lib/recovery";
import { LocalizedSendError } from "./send-error";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The cap for this send: MAX_TX_INPUTS, or none in recovery mode. */
export const utxoInputCap = (): number => (isRecoveryMode() ? Infinity : MAX_TX_INPUTS);

export function buildWithUtxoInputCap<R>(build: (maxInputs: number) => R, t: T, asset: { decimals: number; symbol: string }): R {
  try {
    return build(utxoInputCap());
  } catch (e) {
    if (e instanceof TooManyInputsError) {
      throw new LocalizedSendError(t("send.tooManyInputs", { max: e.max, amount: formatUnits(e.coverSats, asset.decimals), symbol: asset.symbol }));
    }
    throw e;
  }
}
