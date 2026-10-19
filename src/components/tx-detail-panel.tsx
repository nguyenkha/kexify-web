// In-app transaction detail (UX spec: history.md "Transaction detail").
// Side panel on desktop, full-height sheet on mobile. Shows only what the chain adapter gives us
// (no fee field exists on Transaction today; Stellar memo / XRP destination tag when set), and keeps the explorer link inside.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Transaction } from "../shared/types";
import { explorerLink } from "../shared/utils";
import { fetchPrices, formatUsd, getUsdValue } from "../lib/prices";
import { useHideBalances } from "../context/HideBalancesContext";
import { maskAmount, maskUsd } from "../lib/hidden-amount";
import { addressLabel } from "../lib/address-label";
import { txShowsAmount, txSign, txTitle } from "../lib/tx-display";
import { CopyableText } from "./ui";

interface TxDetailPanelProps {
  tx: Transaction;
  explorerUrl: string;
  networkName?: string;
  onClose: () => void;
}

function StatusPill({ tx }: { tx: Transaction }) {
  const { t } = useTranslation();
  const [cls, label] = tx.failed
    ? ["bg-red-500/10 text-red-400", t("tx.failed")]
    : !tx.confirmed
      ? ["bg-yellow-500/10 text-yellow-400", t("tx.pending")]
      : ["bg-green-500/10 text-green-500", t("tx.confirmed")];
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1">{label}</p>
      <div className="text-xs text-text-secondary">{children}</div>
    </div>
  );
}

function AddressValue({ address }: { address: string }) {
  const label = addressLabel(address);
  return (
    <div>
      {label && <p className="text-xs font-medium text-text-primary mb-0.5">{label}</p>}
      <CopyableText value={address} textClassName="font-mono break-all text-[11px]" />
    </div>
  );
}

export function TxDetailPanel({ tx, explorerUrl, networkName, onClose }: TxDetailPanelProps) {
  const { t } = useTranslation();
  const { hidden } = useHideBalances();
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    fetchPrices().then((p) => { if (!cancelled) setPrices(p); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const usd = getUsdValue(tx.formatted, tx.symbol, prices);
  const swap = tx.kind?.type === "swap" ? tx.kind : null;
  const showAmount = !swap && txShowsAmount(tx) && (!!tx.kind || !tx.isApprove);
  const amountColor = tx.failed ? "text-red-400 line-through" : tx.direction === "in" ? "text-green-500" : "text-text-primary";
  const date = new Date(tx.timestamp * 1000);

  return createPortal(
    <div className="fixed inset-0 z-50 flex md:justify-end" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={txTitle(tx, t, hidden)}
        className="relative mt-auto md:mt-0 w-full md:w-[380px] h-[100dvh] md:h-full bg-surface-secondary border-l border-border-primary shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary">{txTitle(tx, t, hidden)}</h3>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center text-center px-4 py-6 gap-1.5">
            {showAmount && (
              <p className={`text-2xl font-semibold tabular-nums break-all ${amountColor}`}>
                {hidden ? "" : txSign(tx)}{maskAmount(tx.formatted, tx.symbol, hidden)}
              </p>
            )}
            {swap && (
              <>
                <p className="text-2xl font-semibold tabular-nums break-all text-green-500">
                  {hidden ? "" : "+"}{maskAmount(swap.in.amount, swap.in.symbol, hidden)}
                </p>
                <p className="text-sm text-text-muted tabular-nums">
                  {hidden ? "" : "-"}{maskAmount(swap.out.amount, swap.out.symbol, hidden)}
                </p>
              </>
            )}
            {showAmount && usd != null && (
              <p className="text-sm text-text-muted tabular-nums">{maskUsd(formatUsd(usd), hidden)}</p>
            )}
            <div className="mt-1"><StatusPill tx={tx} /></div>
            {!tx.confirmed && !tx.failed && (
              <p className="text-[11px] text-yellow-400/80 mt-1">{t("tx.waitingConfirmation")}</p>
            )}
          </div>

          <div className="mx-4 mb-4 bg-surface-primary border border-border-primary rounded-lg divide-y divide-border-secondary">
            {tx.from && <Field label={t("tx.from")}><AddressValue address={tx.from} /></Field>}
            {tx.to && <Field label={t("tx.to")}><AddressValue address={tx.to} /></Field>}
            {tx.isDeployment && tx.createdContract && (
              <Field label={t("tx.contractAddr")}><AddressValue address={tx.createdContract} /></Field>
            )}
            {tx.memo && (
              <Field label={t(tx.memo.kind === "destinationTag" ? "send.destinationTag" : "send.memo")}>
                <CopyableText value={tx.memo.value} textClassName="font-mono break-all text-[11px]" />
              </Field>
            )}
            {networkName && <Field label={t("tx.network")}>{networkName}</Field>}
            <Field label={t("tx.date")}>
              {date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </Field>
            <Field label={t("tx.hash")}>
              <CopyableText value={tx.hash} textClassName="font-mono break-all text-[11px]" />
            </Field>
          </div>
        </div>

        <div className="px-4 py-3.5 border-t border-border-secondary">
          <a
            href={explorerLink(explorerUrl, `/tx/${tx.hash}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium bg-surface-tertiary text-text-secondary hover:bg-border-primary transition-colors"
          >
            {t("common.viewOnExplorer")}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </div>,
    document.body,
  );
}
