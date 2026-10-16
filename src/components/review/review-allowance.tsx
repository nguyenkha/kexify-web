// "Edit limit" for ERC-20 / TRC-20 approvals (UX spec: review-and-sign.md "Spending cap"). Closed: a text button
// under the hero. Open: the dApp's request, the balance (when smaller) and a custom amount. When the dApp asks for
// unlimited the control is a prominent "Set a limit" nudge and a specific amount is recommended. The parent
// re-encodes the signed bytes.

import { useState } from "react";
import { Pencil } from "lucide-react";
import { allowanceOptions, allowanceText, formatUnits, parseAllowanceInput, UNLIMITED_THRESHOLD, type AllowanceChoice, type ReviewAllowance } from "../../lib/review";
import { useReviewText } from "./review-text";

interface Props {
  allowance: ReviewAllowance;
  dappName: string;
  /** New cap in base units; null = back to the dApp's request. */
  onChange: (amount: bigint | null) => void;
  /** true while the custom field holds no valid amount: Confirm must wait (never sign the request instead). */
  onInvalid: (invalid: boolean) => void;
}

export function AllowanceEditor({ allowance, dappName, onChange, onInvalid }: Props) {
  const { t } = useReviewText();
  const requested = BigInt(allowance.requested);
  const balance = allowance.balance != null ? BigInt(allowance.balance) : null;
  const unlimited = requested >= UNLIMITED_THRESHOLD;
  const options = allowanceOptions(requested, balance);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<AllowanceChoice>(() => {
    const cur = BigInt(allowance.current);
    if (cur === requested) return "requested";
    return balance != null && cur === balance ? "balance" : "custom";
  });
  const [text, setText] = useState(() => (allowance.edited ? allowanceText(BigInt(allowance.current), allowance.decimals) : ""));
  const parsed = parseAllowanceInput(text, allowance.decimals);
  const fmt = (v: bigint) => (v >= UNLIMITED_THRESHOLD ? t("review.unlimited", { symbol: allowance.symbol }) : `${formatUnits(v, allowance.decimals)} ${allowance.symbol}`);

  const pick = (c: AllowanceChoice, amount?: bigint) => {
    setChoice(c);
    onInvalid(c === "custom" && !("amount" in parsed));
    if (c === "requested") onChange(null);
    else if (c === "balance" && amount != null) onChange(amount);
    else if (c === "custom" && "amount" in parsed) onChange(parsed.amount);
  };
  const typeCustom = (v: string) => {
    setText(v);
    setChoice("custom");
    const p = parseAllowanceInput(v, allowance.decimals);
    onInvalid(!("amount" in p));
    if ("amount" in p) onChange(p.amount);
  };

  if (!open) {
    return (
      <div className="text-center -mt-2">
        {/* Unlimited request: a prominent nudge toward a specific amount; otherwise a plain text button. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={unlimited && !allowance.edited
            ? "inline-flex items-center gap-1.5 text-sm font-semibold rounded-full px-3.5 py-1.5 border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15"
            : "inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline"}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden />{t(unlimited && !allowance.edited ? "review.setLimit" : "review.editLimit")}
        </button>
      </div>
    );
  }

  const error = choice === "custom" && "error" in parsed && text !== "" ? parsed.error : null;
  const customAmount = choice === "custom" && "amount" in parsed ? parsed.amount : null;
  return (
    <section className="bg-surface-primary border border-blue-500/30 rounded-xl p-3 space-y-2" aria-label={t("review.cap.title")} data-testid="allowance-editor">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">{t("review.cap.title")}</h4>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-blue-600 dark:text-blue-400">{t("review.cap.done")}</button>
      </div>
      <div role="radiogroup" className="space-y-1.5">
        {options.map((o) => {
          const selected = choice === o.choice;
          const label = o.choice === "requested" ? t("review.cap.requested", { dapp: dappName }) : o.choice === "balance" ? t("review.cap.balance") : t("review.cap.custom");
          return (
            <label key={o.choice} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer ${selected ? "border-blue-500 bg-blue-500/5" : "border-border-primary"}`}>
              <input type="radio" name="allowance" checked={selected} onChange={() => pick(o.choice, o.amount)} className="accent-blue-600" />
              <span className="flex-1 min-w-0">
                <span className="text-sm text-text-primary">{label}</span>
                {o.recommended && <span className="ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">{t("review.cap.recommended")}</span>}
              </span>
              {o.choice !== "custom" && o.amount != null && <span className="text-sm tabular-nums text-text-secondary">{fmt(o.amount)}</span>}
            </label>
          );
        })}
      </div>
      {choice === "custom" && (
        <div>
          <div className={`flex items-center gap-2 rounded-lg border bg-surface-secondary px-3 py-2 ${error ? "border-red-500" : "border-border-primary focus-within:border-blue-500"}`}>
            <input
              autoFocus
              inputMode="decimal"
              value={text}
              onChange={(e) => typeCustom(e.target.value)}
              placeholder="0"
              aria-invalid={!!error}
              aria-label={t("review.cap.custom")}
              className="flex-1 bg-transparent outline-none text-sm tabular-nums text-text-primary"
            />
            <span className="text-xs text-text-muted">{allowance.symbol}</span>
          </div>
          {error && (
            <p className="text-xs text-red-500 mt-1" role="alert">
              {t(`review.cap.err.${error}`, { symbol: allowance.symbol, decimals: allowance.decimals })}
            </p>
          )}
          {customAmount === 0n && <p className="text-xs text-text-muted mt-1">{t("review.cap.zero")}</p>}
          {customAmount != null && balance != null && customAmount > balance && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{t("review.cap.overBalance")}</p>}
        </div>
      )}
      <p className="text-[11px] text-text-muted">{t("review.cap.help")}</p>
    </section>
  );
}
