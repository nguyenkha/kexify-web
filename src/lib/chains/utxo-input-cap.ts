// Input cap for BTC / LTC / BCH sends. Every input needs its own ECDSA signature and the API co-signs at
// most MAX_TX_INPUTS of them in one MPC batch (api MAX_BATCH_SIGNATURES, KD 2026-10-17). Coin selection
// stops there; an amount that needs more inputs fails with TooManyInputsError, which says how much the
// largest MAX_TX_INPUTS coins can send (what "Max" fills in).

export const MAX_TX_INPUTS = 50;

/**
 * The amount needs more than `max` inputs. `coverSats` = the most one tx of the `max` largest coins can send.
 * The message is stable and parsed by the iOS app (TxCore errors arrive as text): `TOO_MANY_INPUTS max=… cover=…`.
 */
export class TooManyInputsError extends Error {
  readonly max: number;
  readonly coverSats: bigint;
  constructor(max: number, coverSats: bigint) {
    super(`TOO_MANY_INPUTS max=${max} cover=${coverSats}`);
    this.name = "TooManyInputsError";
    this.max = max;
    this.coverSats = coverSats;
  }
}

/**
 * Largest amount one tx of at most `max` coins of `pool` can send with no change output, after `feeFor`
 * (inputs, outputs) → fee: the best prefix of the largest coins, so coins worth less than their own input fee
 * are left out. selectUtxos (largest first) builds that amount with the same coins. `capped` = the pool has
 * more coins than one tx can spend, so the rest stays behind.
 */
export function maxSendableFrom(
  pool: { value: number }[],
  max: number,
  feeFor: (inputs: number, outputs: number) => bigint,
): { sats: bigint; inputs: number; capped: boolean } {
  const top = [...pool].sort((a, b) => b.value - a.value).slice(0, max);
  let best = { sats: 0n, inputs: 0 };
  let total = 0n;
  top.forEach((u, i) => {
    total += BigInt(u.value);
    const net = total - feeFor(i + 1, 1);
    if (net > best.sats) best = { sats: net, inputs: i + 1 };
  });
  return { ...best, capped: pool.length > max };
}
