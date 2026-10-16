// Detail rows, actions list, fee + total, message and raw data of a review model.

import { ArrowUp, CircleHelp, FileText, KeyRound, Plus, Puzzle, Coins, UserCog, XCircle } from "lucide-react";
import type { ActionIcon, ReviewAction, ReviewModel, ReviewRow } from "../../lib/review";
import { PartyInline, PartyValue } from "./review-address";
import { useReviewText } from "./review-text";

const card = "bg-surface-primary border border-border-primary rounded-xl overflow-hidden divide-y divide-border-secondary";
const ACTION_ICONS: Record<ActionIcon, typeof ArrowUp> = {
  send: ArrowUp, approve: KeyRound, authority: UserCog, close: XCircle, create: Plus, memo: FileText, program: Puzzle, token: Coins, unknown: CircleHelp,
};

function Row({ row, copyable }: { row: ReviewRow; copyable: boolean }) {
  const { text, date } = useReviewText();
  const label = <span className="text-xs text-text-muted shrink-0">{text(row.label)}</span>;
  if (row.party && row.fullAddress) {
    return (
      <div className="px-3 py-2.5 space-y-1">
        {label}
        <PartyValue party={row.party} full copyable={copyable} />
      </div>
    );
  }
  return (
    <div className="px-3 py-2.5 flex items-start justify-between gap-3">
      {label}
      <span className="text-right min-w-0">
        {row.party ? <PartyValue party={row.party} copyable={copyable} /> : (
          <span className="text-sm text-text-primary tabular-nums break-words">{row.date ? date(row.date) : text(row.value)}</span>
        )}
        {row.sub && <span className="block text-xs text-text-muted tabular-nums">{text(row.sub)}</span>}
      </span>
    </div>
  );
}

function Action({ action, index }: { action: ReviewAction; index: number }) {
  const { text } = useReviewText();
  const Icon = ACTION_ICONS[action.icon];
  const tone = action.tone === "danger" ? "bg-red-500/10 text-red-600 dark:text-red-400"
    : action.tone === "warning" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : action.icon === "send" || action.icon === "approve" ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-surface-tertiary text-text-tertiary";
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <span className="text-[10px] text-text-muted w-3 text-right pt-2 tabular-nums">{index + 1}</span>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-3.5 h-3.5" aria-hidden /></span>
      <div className="min-w-0">
        <p className="text-sm text-text-primary font-medium break-words">{text(action.title)}</p>
        {action.party && <p className="text-xs text-text-muted"><PartyInline prefix={action.party.prefix} party={action.party.party} expandable /></p>}
        {action.detail && <p className="text-xs text-text-muted break-all">{text(action.detail)}</p>}
      </div>
    </li>
  );
}

export function ReviewDetails({ model, copyable, expert }: { model: ReviewModel; copyable: boolean; expert?: boolean }) {
  const { t, text, usd } = useReviewText();
  const { fee, total } = model;
  return (
    <>
      {model.actions.length > 0 && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted px-1 pb-1.5">{t("review.actions", { count: model.actions.length })}</h4>
          <ol className={card} data-testid="review-actions">
            {model.actions.map((a, i) => <Action key={i} action={a} index={i} />)}
          </ol>
        </section>
      )}

      <div className={card} data-testid="review-rows">
        {model.rows.map((r, i) => <Row key={i} row={r} copyable={copyable} />)}
      </div>

      {model.message != null && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted px-1 pb-1.5">{t("review.message")}</h4>
          <pre className="bg-surface-primary border border-border-primary rounded-xl px-3 py-2.5 text-xs font-mono text-text-primary whitespace-pre-wrap break-all max-h-72 overflow-auto">{model.message}</pre>
        </section>
      )}

      {(fee || model.noFee === "signature") && (
        <div className={card} data-testid="review-fee">
          <div className="px-3 py-2.5 flex items-start justify-between gap-3">
            <span className="text-xs text-text-muted">{t("send.networkFee")}</span>
            <span className="text-right">
              {model.noFee === "signature" ? <span className="text-sm text-text-primary">{t("review.noFeeSignature")}</span>
                : fee?.loading ? <span className="text-sm text-text-muted animate-pulse">{t("review.estimating")}</span>
                  : <span className="text-sm text-text-primary tabular-nums">{fee?.approx ? "≈ " : ""}{fee?.amount}</span>}
              {fee && !fee.loading && (fee.usd != null || fee.inclPriority) && (
                <span className="block text-xs text-text-muted tabular-nums">
                  {[fee.usd != null ? usd(fee.usd) : null, fee.inclPriority ? t("review.inclPriority") : null].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
          </div>
          {fee?.details && fee.details.length > 0 && (
            <details className="px-3 py-2.5 group">
              <summary className="text-xs text-text-tertiary cursor-pointer select-none">{t("review.feeDetails")}</summary>
              <div className="mt-2 space-y-1">
                {fee.details.map((r, i) => (
                  <div key={i} className="flex justify-between gap-3 text-xs"><span className="text-text-muted">{text(r.label)}</span><span className="text-text-secondary tabular-nums">{text(r.value)}</span></div>
                ))}
              </div>
            </details>
          )}
          {total && total.parts.length > 0 && (
            <div className="px-3 py-2.5 flex items-start justify-between gap-3">
              <span className="text-xs text-text-muted font-medium">{t("send.total")}</span>
              <span className="text-right">
                <span className="text-sm font-semibold text-text-primary tabular-nums">{total.usd != null ? `≈ ${usd(total.usd)}` : total.parts.join(" + ")}</span>
                {total.usd != null && <span className="block text-xs text-text-muted tabular-nums">{total.native ?? total.parts.join(" + ")}</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {model.raw && (
        <details className="bg-surface-primary border border-border-primary rounded-xl px-3 py-2.5" open={expert}>
          <summary className="text-xs text-text-tertiary cursor-pointer select-none">{t("review.rawData")}</summary>
          <pre className="mt-2 text-[10px] font-mono text-text-muted break-all whitespace-pre-wrap max-h-48 overflow-auto">{model.raw}</pre>
        </details>
      )}
    </>
  );
}
