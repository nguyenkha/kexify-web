// Hide-balances masking (UX spec: home-assets.md "Hide balances").
// USD values become "••••••"; token amounts become "•••••• SYMBOL" so the asset stays readable.

import { getUserOverrides } from "./userOverrides";

export const MASK = "••••••";

export function maskUsd(usd: string, hidden: boolean): string {
  return hidden ? MASK : usd;
}

/** Amount with its symbol, e.g. "0.5 ETH" or "•••••• ETH" when hidden. */
export function maskAmount(amount: string, symbol: string, hidden: boolean): string {
  return `${hidden ? MASK : amount} ${symbol}`.trim();
}

/** Current hide-balances setting outside React (toasts fired from polling, OS notifications). */
export function balancesHiddenNow(): boolean {
  try {
    return getUserOverrides().hide_balances === true;
  } catch {
    return false;
  }
}
