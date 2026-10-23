// Konfirm (https://konfirm.kha.do): BTC and Ethereum mainnet fee estimates from its REST API (/api/v1/btc/fees,
// /api/v1/eth/fees; CORS open). Callers use it first and fall back to their previous source on any error or a stale
// answer, so a Konfirm outage only costs one timeout.

import type { FeeRates } from "./btcTx";

export const KONFIRM_URL = "https://konfirm.kha.do";
const TIMEOUT_MS = 4_000;
/** sat/vB above this is a bad answer, not a fee market (same bound as the API's chain proxy). */
const MAX_SAT_PER_VB = 2_000;

interface KonfirmFees<R> { stale?: boolean; recommendations?: R[] }

async function konfirmFees<R>(chain: "btc" | "eth"): Promise<KonfirmFees<R>> {
  const res = await fetch(`${KONFIRM_URL}/api/v1/${chain}/fees`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Konfirm ${chain} fees: ${res.status}`);
  const body = await res.json() as KonfirmFees<R>;
  if (body.stale !== false || !Array.isArray(body.recommendations)) throw new Error(`Konfirm ${chain} fees: stale or empty`);
  return body;
}

/** sat/vB -> whole sat/vB, at least 1 (what mempool.space's recommended fees use). */
function satPerVb(rate: unknown): number {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > MAX_SAT_PER_VB) throw new Error("Konfirm: bad fee rate");
  return Math.max(1, Math.round(rate));
}

/** BTC mainnet fee rates in mempool.space's shape: targets 1 / 3 / 6 blocks. */
export async function fetchKonfirmBtcFeeRates(): Promise<FeeRates> {
  const { recommendations } = await konfirmFees<{ target_blocks?: unknown; fee_rate?: unknown }>("btc");
  const rate = (t: number) => satPerVb(recommendations!.find((r) => r.target_blocks === t)?.fee_rate);
  const hour = rate(6);
  return { fastestFee: rate(1), halfHourFee: rate(3), hourFee: hour, economyFee: hour, minimumFee: 1 };
}

/** Ethereum mainnet gas price like eth_gasPrice: next base fee + the standard tip, in wei. */
export async function fetchKonfirmEthGasPrice(): Promise<bigint> {
  const body = await konfirmFees<{ urgency?: unknown; max_priority_fee_per_gas?: unknown }>("eth") as
    KonfirmFees<{ urgency?: unknown; max_priority_fee_per_gas?: unknown }> & { next_base_fee_per_gas?: unknown };
  const base = body.next_base_fee_per_gas;
  const tip = body.recommendations!.find((r) => r.urgency === "standard")?.max_priority_fee_per_gas;
  if (typeof base !== "number" || typeof tip !== "number" || !Number.isFinite(base + tip) || base <= 0 || tip < 0) {
    throw new Error("Konfirm: bad gas price");
  }
  return BigInt(Math.round((base + tip) * 1e9)); // gwei -> wei
}
