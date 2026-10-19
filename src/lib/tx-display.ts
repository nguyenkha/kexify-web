// Shared display helpers for transaction rows and the transaction detail view.

import type { TFunction } from "i18next";
import type { Transaction, TxKind } from "../shared/types";
import { knownEvmContract } from "./review/known-contracts";
import { addressLabel } from "./address-label";
import { MASK } from "./hidden-amount";

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
/** `hidden`: Hide balances is on, so the amounts in a swap / approval title are masked like the amount column. */
export function txTitle(tx: Transaction, t: TFunction, hidden = false): string {
  if (tx.kind) return kindTitle(tx.kind, t, hidden);
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
  if (tx.isDeployment || tx.isApprove || tx.kind?.type === "approve" || tx.kind?.type === "revoke") return "";
  return tx.direction === "in" ? "+" : tx.direction === "out" ? "-" : "";
}

/** The other party of the transfer (sender for incoming, recipient otherwise). */
export function txCounterparty(tx: Transaction): string {
  return tx.direction === "in" ? tx.from : tx.to;
}

/** Spender / operator for a title: a known contract name or address-book label, else the short address. */
export function spenderName(addr: string): string {
  return knownEvmContract(addr) ?? addressLabel(addr) ?? shortAddr(addr);
}

function kindTitle(kind: TxKind, t: TFunction, hidden: boolean): string {
  const amt = (a: string) => (hidden ? MASK : a);
  switch (kind.type) {
    case "approve": {
      const spender = spenderName(kind.spender);
      if (kind.unlimited) return t("tx.approvedUnlimited", { symbol: kind.symbol, spender });
      if (kind.amount) return t("tx.approvedAmount", { amount: amt(kind.amount), symbol: kind.symbol, spender });
      return t("tx.approvedToken", { symbol: kind.symbol, spender });
    }
    case "revoke": return t("tx.revokedApproval", { symbol: kind.symbol });
    case "approveNfts": return t("tx.approvedAllNfts", { operator: spenderName(kind.operator) });
    case "revokeNfts": return t("tx.revokedNfts");
    case "swap": return t("tx.swapped", { outAmount: amt(kind.out.amount), out: kind.out.symbol, inAmount: amt(kind.in.amount), in: kind.in.symbol });
    case "call": return kind.method ? t("tx.contractCallMethod", { method: kind.method }) : t("tx.contractCall");
  }
}

/** Colour classes and icon path for a classified row (approve / revoke / swap / contract call). */
export function kindStyle(kind: TxKind): { text: string; bg: string; icon: string } {
  switch (kind.type) {
    case "approve":
    case "approveNfts":
      return { text: "text-blue-400", bg: "bg-blue-400/10", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" };
    case "revoke":
    case "revokeNfts":
      return { text: "text-text-muted", bg: "bg-surface-tertiary", icon: "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" };
    case "swap":
      return { text: "text-purple-400", bg: "bg-purple-400/10", icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" };
    case "call":
      return { text: "text-orange-400", bg: "bg-orange-400/10", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" };
  }
}

/** Whether the amount column / header means anything: approvals say their amount in the title, not as "-0 ETH". */
export function txShowsAmount(tx: Transaction): boolean {
  if (tx.isDeployment) return false;
  if (!tx.kind) return !tx.isApprove;
  return tx.kind.type === "swap" || (tx.kind.type === "call" && tx.value !== "0");
}
