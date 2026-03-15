import { getUsdValue, formatUsd } from "../lib/prices";

export interface BalanceChange {
  symbol: string;
  decimals: number;
  currentBalance: string; // raw base units as string
  delta: bigint;          // negative = outgoing, positive = incoming
}

function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  let result: string;
  if (frac === 0n) {
    result = whole.toString();
  } else {
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 8).replace(/0+$/, "");
    result = `${whole}.${fracStr}`;
  }
  return negative ? `-${result}` : result;
}

export function BalancePreview({
  changes,
  prices,
}: {
  changes: BalanceChange[];
  prices: Record<string, number>;
}) {
  if (changes.length === 0) return null;

  return (
    <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
      {changes.map((change, i) => {
        const currentBal = BigInt(change.currentBalance);
        const afterBal = currentBal + change.delta;
        const afterFormatted = formatUnits(afterBal < 0n ? -afterBal : afterBal, change.decimals);
        const deltaFormatted = formatUnits(change.delta, change.decimals);
        const isNegative = change.delta < 0n;
        const isPositive = change.delta > 0n;
        const afterUsd = afterBal >= 0n ? getUsdValue(afterFormatted, change.symbol, prices) : null;

        return (
          <div key={change.symbol} className={i > 0 ? "border-t border-border-secondary" : ""}>
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-text-muted">{change.symbol}</span>
              <div className="text-right flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-text-muted">
                  {formatUnits(currentBal, change.decimals)}
                </span>
                <svg className="w-3 h-3 text-text-muted/50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className={`text-[11px] tabular-nums font-medium ${afterBal < 0n ? "text-red-400" : "text-text-secondary"}`}>
                  {afterBal < 0n ? `-${afterFormatted}` : afterFormatted}
                </span>
              </div>
            </div>
            <div className="px-3 pb-2 flex items-center justify-between">
              <span className="text-[10px] text-text-muted/60">Change</span>
              <div className="text-right">
                <span className={`text-[10px] tabular-nums font-medium ${isNegative ? "text-red-400" : isPositive ? "text-green-400" : "text-text-muted"}`}>
                  {isPositive ? "+" : ""}{deltaFormatted} {change.symbol}
                </span>
                {afterUsd != null && afterUsd > 0 && (
                  <span className="text-[10px] text-text-muted ml-1.5 tabular-nums">
                    ({formatUsd(afterUsd)})
                  </span>
                )}
                {afterBal < 0n && (
                  <span className="text-[10px] text-red-400 ml-1.5">Insufficient</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
