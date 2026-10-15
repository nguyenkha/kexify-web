// Shared display helpers for transaction rows and the transaction detail view.

import type { TFunction } from "i18next";
import type { Transaction } from "../shared/types";

export function shortAddr(addr: string | undefined): string {
  if (!addr) return "—";
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Relative time ("5m ago") for recent transactions, a short date after a week. */
export function formatTxTime(ts: number, t: TFunction): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return t("activity.justNow");
  if (diffMin < 60) return t("activity.minutesAgo", { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("activity.hoursAgo", { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return t("activity.daysAgo", { count: diffDay });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

/** Row / detail title: Sent, Received, Approved, Enabled USDC, ... (status is shown separately). */
export function txTitle(tx: Transaction, t: TFunction): string {
  if (tx.label) {
    if (tx.label.startsWith("enabled:")) return t("tx.enabled", { symbol: tx.label.slice(8) });
    if (tx.label.startsWith("opt-in:")) return t("tx.optedIn", { symbol: tx.label.slice(7) });
    return tx.label;
  }
  if (tx.isDeployment) return t("tx.deployedContract");
  if (tx.direction === "in") return t("tx.received");
  if (tx.direction === "out") return tx.isApprove ? t("tx.approved") : tx.isContractCall ? t("tx.executedContract") : t("tx.sent");
  return t("tx.self");
}

export function txSign(tx: Transaction): string {
  if (tx.isDeployment || tx.isApprove) return "";
  return tx.direction === "in" ? "+" : tx.direction === "out" ? "-" : "";
}

/** The other party of the transfer (sender for incoming, recipient otherwise). */
export function txCounterparty(tx: Transaction): string {
  return tx.direction === "in" ? tx.from : tx.to;
}
