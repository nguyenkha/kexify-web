import { formatUsd } from "../lib/prices";
import { useHideBalances } from "../context/HideBalancesContext";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { MASK } from "../lib/hidden-amount";

interface PortfolioHeaderProps {
  totalUsd: number;
  loading: boolean;
  /** Every wallet's emergency kit is verified: show the small green "Fully protected" label. */
  fullyProtected?: boolean;
}

/** Displays total portfolio value in USD at the top of the wallet overview */
export function PortfolioHeader({ totalUsd, loading, fullyProtected }: PortfolioHeaderProps) {
  const { hidden } = useHideBalances();
  const { t } = useTranslation();

  return (
    <div className="text-center py-4">
      <p className="text-[11px] text-text-muted uppercase tracking-wider font-semibold mb-1">
        {t("wallet.portfolioValue")}
      </p>
      {loading && totalUsd === 0 ? (
        <div className="h-8 w-32 bg-surface-tertiary rounded animate-pulse mx-auto" />
      ) : (
        <p className="text-2xl font-semibold text-text-primary tabular-nums">
          {hidden ? MASK : formatUsd(totalUsd)}
        </p>
      )}
      {fullyProtected && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-green-500">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
          {t("protection.full")}
        </p>
      )}
    </div>
  );
}
