/**
 * Cardano absolute slot from wall-clock time.
 *
 * Since Shelley every slot is 1 s, so slot = shelleyStartSlot + (unixSeconds - shelleyStartTime).
 * The slot/block-height ratio drifts (blocks are ~20 s apart on average, Byron slots were 20 s),
 * so the block height must never be used to estimate a slot.
 */

interface ShelleyStart {
  slot: number;
  unixSeconds: number;
}

const SHELLEY_START: Record<"mainnet" | "preprod", ShelleyStart> = {
  // Shelley hard fork at epoch 208: 2020-07-29T21:44:51Z
  mainnet: { slot: 4_492_800, unixSeconds: 1_596_059_091 },
  // Preprod: 4 Byron epochs of 21600 x 20 s slots after systemStart 2022-06-01T00:00:00Z
  preprod: { slot: 86_400, unixSeconds: 1_655_769_600 },
};

/** Absolute slot at `unixMs` (e.g. a block timestamp) on the given network. */
export function adaSlotAtTime(network: "mainnet" | "preprod", unixMs: number): number {
  if (!Number.isFinite(unixMs) || unixMs <= 0) throw new Error("Invalid Cardano block timestamp");
  const start = SHELLEY_START[network];
  const slot = start.slot + Math.floor(unixMs / 1000) - start.unixSeconds;
  if (slot < start.slot) throw new Error("Cardano block timestamp is before Shelley");
  return slot;
}

/**
 * Tip from a Rosetta /network/status response. The slot comes from the tip block's timestamp
 * (ms, required by the Rosetta spec); block height * 20 is off by tens of millions of slots.
 */
export function adaTipFromRosettaStatus(
  network: "mainnet" | "preprod",
  data: { current_block_identifier?: { index?: number }; current_block_timestamp?: number },
): { slot: number; blockHeight: number } {
  const blockHeight = data.current_block_identifier?.index ?? 0;
  return { slot: adaSlotAtTime(network, Number(data.current_block_timestamp)), blockHeight };
}
