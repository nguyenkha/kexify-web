import { useTranslation } from "react-i18next";
import { CopyableText } from "../ui";
import { formatUnits, shortAddress, trimDecimals } from "../../lib/review/review-format";
import { spenderLabel, type ContractInfo } from "../../lib/approvals/approval-labels";
import { isUnlimited, type Approval } from "../../lib/approvals/types";

interface Props {
  approval: Approval;
  info?: ContractInfo;
  revoking: boolean;
  disabled: boolean;
  onRevoke: () => void;
}

/** One approval: what is shared, with whom, how much, since when, and the Revoke button. */
export function ApprovalRow({ approval: a, info, revoking, disabled, onRevoke }: Props) {
  const { t, i18n } = useTranslation();
  const name = info?.name || shortAddress(a.contract);
  const spender = spenderLabel(a.spender);
  const unlimited = isUnlimited(a);
  let amount: string;
  if (a.kind === "nft_all") amount = t("approvals.allNfts");
  else if (unlimited) amount = t("approvals.unlimited");
  else if (info?.decimals != null) amount = `${trimDecimals(formatUnits(a.allowance!, info.decimals))} ${info.symbol}`;
  else amount = a.allowance!.toString();
  const date = a.timestamp ? new Date(a.timestamp * 1000).toLocaleDateString(i18n.language) : "—";

  return (
    <li className="bg-surface-secondary border border-border-primary rounded-xl p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{name}</p>
          <p className="text-[11px] text-text-muted">{a.kind === "nft_all" ? t("approvals.collection") : info?.symbol ?? ""}</p>
        </div>
        <span className={`text-sm font-semibold shrink-0 ${unlimited || a.kind === "nft_all" ? "text-red-400" : "text-text-primary"}`}>{amount}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-text-tertiary min-w-0">
        <span className="shrink-0">{t("approvals.spender")}</span>
        <CopyableText value={a.spender} className="min-w-0" textClassName="text-text-secondary truncate">
          {spender ?? shortAddress(a.spender)}
        </CopyableText>
      </div>
      {a.flagged && (
        <span className="inline-block text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-0.5">
          {t("approvals.flagged")}
        </span>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] text-text-muted">{t("approvals.granted", { date })}</span>
        <button
          onClick={onRevoke}
          disabled={revoking || disabled}
          className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {revoking ? t("approvals.revoking") : t("approvals.revoke")}
        </button>
      </div>
    </li>
  );
}
