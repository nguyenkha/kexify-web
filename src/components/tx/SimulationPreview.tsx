// Shared simulation result display for Send/WC preview
// Uses same visual format as BalancePreview for consistency. Always labelled as an estimate.

import { useTranslation } from "react-i18next";
import type { SimulationResult } from "../../lib/txSimulation";
import { getUsdValue, formatUsd } from "../../lib/prices";

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function SimulationPreview({ simResult, prices }: { simResult: SimulationResult; prices?: Record<string, number> }) {
  const { t } = useTranslation();
  if (simResult.changes.length === 0) return null;
  const provider = simResult.provider === "rpc" ? "" : simResult.provider.charAt(0).toUpperCase() + simResult.provider.slice(1);

  return (
    <div>
      <p className="text-[11px] text-text-muted mb-1.5">{t("send.simEstimatedTitle")}</p>
      <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
        {simResult.changes.map((c, i) => {
          // Price only assets from the app's token list; a contract can name itself anything
          const usd = prices && c.asset.known === true ? getUsdValue(c.amount, c.asset.symbol, prices) : null;
          return (
            <div key={i} className={i > 0 ? "border-t border-border-secondary" : ""}>
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-text-muted">{c.asset.symbol}</div>
                  {c.asset.known !== true && c.asset.contractAddress && (
                    <div className="text-[10px] text-text-muted/70 font-mono truncate">{shortAddr(c.asset.contractAddress)}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className={`text-[11px] tabular-nums font-medium ${c.direction === "out" ? "text-red-400" : "text-green-400"}`}>
                    {c.direction === "out" ? "-" : "+"}{c.amount} {c.asset.symbol}
                  </div>
                  {usd != null && usd > 0 && (
                    <div className="text-[10px] text-text-muted tabular-nums">
                      {formatUsd(usd)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-text-muted/60 mt-1.5">
        {simResult.feeIncluded ? t("send.simNoteFeeIncluded") : t("send.simNoteNoFee")}
        {provider && ` · ${t("send.simulatedVia", { provider })}`}
      </p>
    </div>
  );
}

/** Predicted revert or simulation unavailable. Informational only: signing stays available. */
export function SimulationStatusNote({ simResult }: { simResult: SimulationResult | null }) {
  const { t } = useTranslation();
  if (simResult?.reverted) {
    return (
      <p className="text-[11px] text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
        {t("send.simMayFail")}
      </p>
    );
  }
  if (simResult?.error) return <p className="text-[10px] text-text-muted/70">{t("send.simUnavailable")}</p>;
  return null;
}
