// The 3 settings of the simple policy: daily send limit, who you can send to, and what happens
// above the limit. Pure form: the parent compiles, asks for the passkey and submits.

import { getAddressBook } from "../../lib/addressBook";
import type { OverLimit, SimplePolicy } from "../../lib/simple-policy-api";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Large-amount wait is a premium feature later; on for everyone until entitlements exist. */
export const OVER_LIMIT_WAIT_ENABLED = true;

const field = "w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary";

export function SimplePolicyForm({ value, onChange, t }: { value: SimplePolicy; onChange: (v: SimplePolicy) => void; t: T }) {
  const book = getAddressBook();
  const noLimit = value.dailyLimitUsd === null;
  const limitValid = isLimitValid(value);
  const toggleTrusted = (addr: string) => onChange({
    ...value,
    trusted: value.trusted.includes(addr) ? value.trusted.filter((a) => a !== addr) : [...value.trusted, addr],
  });

  return (
    <div className="space-y-4" data-testid="simple-policy-form">
      <section className="space-y-1.5">
        <label className="text-xs font-medium text-text-primary">{t("simplePolicy.dailyLimit")}</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">$</span>
          <input
            inputMode="decimal"
            disabled={noLimit}
            value={value.dailyLimitUsd ?? ""}
            onChange={(e) => onChange({ ...value, dailyLimitUsd: e.target.value.trim() })}
            className={`${field} disabled:opacity-40`}
            aria-invalid={!limitValid}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={noLimit} onChange={(e) => onChange({ ...value, dailyLimitUsd: e.target.checked ? null : "1000" })} />
          {t("simplePolicy.noLimit")}
        </label>
        <p className="text-[11px] text-text-muted leading-relaxed">{t("simplePolicy.dailyLimitHint")}</p>
        {!limitValid && <p className="text-[11px] text-red-500">{t("simplePolicy.limitInvalid")}</p>}
      </section>

      <section className="space-y-1.5">
        <label className="text-xs font-medium text-text-primary">{t("simplePolicy.sendTo")}</label>
        {(["anywhere", "trusted"] as const).map((v) => (
          <label key={v} className="flex items-start gap-2 text-sm text-text-secondary">
            <input type="radio" name="sendTo" checked={value.sendTo === v} onChange={() => onChange({ ...value, sendTo: v, trusted: v === "anywhere" ? [] : value.trusted })} className="mt-1" />
            <span>
              {t(`simplePolicy.sendTo_${v}`)}
              <span className="block text-[11px] text-text-muted">{t(`simplePolicy.sendTo_${v}Hint`)}</span>
            </span>
          </label>
        ))}
        {value.sendTo === "trusted" && (
          <div className="ml-6 space-y-1">
            {book.length === 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("simplePolicy.noAddressBook")}</p>}
            {book.map((e) => (
              <label key={`${e.chain ?? ""}:${e.address}`} className="flex items-center gap-2 text-xs text-text-secondary">
                <input type="checkbox" checked={value.trusted.includes(e.address)} onChange={() => toggleTrusted(e.address)} />
                <span className="truncate">{e.label}</span>
                <span className="font-mono text-[10px] text-text-muted truncate">{e.address}</span>
              </label>
            ))}
            {value.trusted.length === 0 && book.length > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("simplePolicy.noTrustedSelected")}</p>}
          </div>
        )}
      </section>

      {OVER_LIMIT_WAIT_ENABLED && !noLimit && (
        <section className="space-y-1.5">
          <label className="text-xs font-medium text-text-primary">{t("simplePolicy.overLimit")}</label>
          <select value={value.overLimit} onChange={(e) => onChange({ ...value, overLimit: e.target.value as OverLimit })} className={field}>
            <option value="block">{t("simplePolicy.overLimit_block")}</option>
            <option value="wait_1h">{t("simplePolicy.overLimit_wait_1h")}</option>
            <option value="wait_24h">{t("simplePolicy.overLimit_wait_24h")}</option>
          </select>
          <p className="text-[11px] text-text-muted leading-relaxed">{t("simplePolicy.overLimitHint")}</p>
        </section>
      )}
    </div>
  );
}

/** The server's limit rule (whole dollars and cents, > 0); the limit field alone. */
export function isLimitValid(v: SimplePolicy): boolean {
  return v.dailyLimitUsd === null || (/^\d{1,12}(\.\d{1,2})?$/.test(v.dailyLimitUsd) && Number(v.dailyLimitUsd) > 0);
}

/** Savable: a valid limit, and "trusted only" with at least one address (else every direct send is blocked). */
export function isSimplePolicyValid(v: SimplePolicy): boolean {
  return isLimitValid(v) && (v.sendTo === "anywhere" || v.trusted.length > 0);
}
