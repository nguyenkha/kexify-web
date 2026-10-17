// Hide-balances masking (UX spec: home-assets.md "Hide balances").
// USD values become "••••••"; token amounts become "•••••• SYMBOL" so the asset stays readable.

import { displayAmount } from "./display-amount";
import { getUserOverrides } from "./userOverrides";

export const MASK = "••••••";

export function maskUsd(usd: string, hidden: boolean): string {
  return hidden ? MASK : usd;
}

/** Amount with its symbol in the UI language, e.g. "0.5 ETH" ("0,5 ETH" in Spanish) or "•••••• ETH" when hidden. */
export function maskAmount(amount: string, symbol: string, hidden: boolean): string {
  return `${hidden ? MASK : displayAmount(amount)} ${symbol}`.trim();
}

/** Current hide-balances setting outside React (toasts fired from polling, OS notifications). */
export function balancesHiddenNow(): boolean {
  try {
    return getUserOverrides().hide_balances === true;
  } catch {
    return false;
  }
}
