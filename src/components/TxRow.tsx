import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Transaction } from "../lib/transactions";
import { useHideBalances } from "../context/HideBalancesContext";
import { MASK } from "../lib/hidden-amount";
import { addressLabel } from "../lib/address-label";
import { formatTxTime, shortAddr, txCounterparty, txSign, txTitle } from "../lib/tx-display";
import { TxDetailPanel } from "./tx-detail-panel";

/** History row. Tapping it opens the in-app transaction detail (explorer link lives there). */
export function TxRow({ tx, explorerUrl, onSpeedUp, chainName, chainIcon, networkName }: { tx: Transaction; explorerUrl: string; onSpeedUp?: () => void; chainName?: string; chainIcon?: string | null; networkName?: string }) {
  const { t } = useTranslation();
  const { hidden } = useHideBalances();
  const [open, setOpen] = useState(false);
  const isPending = !tx.confirmed;
  const isFailed = !!tx.failed;
  const dirColor = isFailed
    ? "text-red-400"
    : isPending
      ? "text-yellow-400"
      : tx.isDeployment
        ? "text-purple-400"
        : tx.direction === "in"
          ? "text-green-500"
          : tx.direction === "out"
            ? (tx.isApprove ? "text-blue-400" : tx.isContractCall ? "text-orange-400" : "text-red-400")
            : "text-text-muted";
  const title = txTitle(tx, t);
  const counterparty = txCounterparty(tx);
  const counterpartyName = addressLabel(counterparty) ?? shortAddr(counterparty);

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      className="flex items-center px-3 md:px-4 py-3.5 hover:bg-surface-tertiary/50 transition-colors group cursor-pointer"
    >
      {/* Direction icon */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mr-3 ${
        isFailed
          ? "bg-red-400/10"
          : isPending
            ? "bg-yellow-400/10"
            : tx.isDeployment
              ? "bg-purple-400/10"
              : tx.direction === "in"
                ? "bg-green-500/10"
                : tx.direction === "out"
                  ? (tx.isApprove ? "bg-blue-400/10" : tx.isContractCall ? "bg-orange-400/10" : "bg-red-400/10")
                  : "bg-surface-tertiary"
      }`}>
        {isFailed ? (
          <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : isPending ? (
          <svg className="w-4 h-4 text-yellow-400 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : tx.isDeployment ? (
          <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        ) : tx.direction === "in" ? (
          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        ) : tx.direction === "out" && tx.isApprove ? (
          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : tx.direction === "out" && tx.isContractCall ? (
          <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        ) : tx.direction === "out" ? (
          <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        )}
      </div>

      {/* Label + counterparty + time */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{title}</span>
          {(isFailed || isPending) && (
            <span className={`text-[10px] font-medium px-1.5 py-px rounded-full shrink-0 ${isFailed ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>
              {isFailed ? t("tx.failed") : t("tx.pending")}
            </span>
          )}
          <span className="text-[11px] text-text-muted shrink-0">{formatTxTime(tx.timestamp, t)}</span>
        </div>
        <div className="text-[11px] text-text-muted font-mono truncate">
          {tx.isDeployment && tx.createdContract
            ? <span>{t("tx.contractAddr")} <span className="text-purple-400/70">{shortAddr(tx.createdContract)}</span></span>
            : `${tx.direction === "in" ? t("tx.from") : t("tx.to")} ${counterpartyName}`}
          <span className="text-text-muted/50 ml-1.5 hidden sm:inline">{shortAddr(tx.hash)}</span>
        </div>
      </div>

      {/* Amount + chain badge */}
      <div className="text-right shrink-0 ml-3">
        {chainName && (
          <div className="flex items-center gap-1 justify-end mb-0.5">
            {chainIcon && <img src={chainIcon} alt="" className="w-3 h-3 rounded-full" />}
            <span className="text-[9px] text-text-muted font-medium">{chainName}</span>
          </div>
        )}
        <div className={`text-sm tabular-nums font-medium ${dirColor} ${isFailed ? "line-through" : ""}`}>
          {hidden ? MASK : `${txSign(tx)}${tx.formatted}`}
        </div>
        <div className="text-[11px] text-text-muted">{tx.symbol}</div>
        {onSpeedUp && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSpeedUp(); }}
            className="inline-flex items-center gap-1 text-[11px] text-yellow-400 hover:text-yellow-300 transition-colors font-medium mt-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t("tx.speedUp")}
          </button>
        )}
      </div>

      {/* Chevron on hover — hidden on mobile */}
      <div className="w-5 justify-end shrink-0 ml-2 hidden md:flex">
        <svg className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
    {open && (
      <TxDetailPanel tx={tx} explorerUrl={explorerUrl} networkName={networkName ?? chainName} onClose={() => setOpen(false)} />
    )}
    </>
  );
}
