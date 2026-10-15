// Per-type input fields for a new policy rule, plus the row summary for value rules.
// transfer and approval share the value fields (asset, caps, address, fraud check);
// account_control has no filters and only shows a warning.

import type { PolicyRuleBody } from "../../shared/types";

type T = (key: string, opts?: Record<string, unknown>) => string;

const INPUT = "w-full bg-surface-secondary border border-border-primary rounded px-2 py-1.5 text-xs text-text-primary";

/** Keep only the fields the server accepts for the rule's type. */
export function sanitizeRule(rule: PolicyRuleBody): PolicyRuleBody {
  const none = { asset: null, amountMax: null, usdMax: null, toAddress: null, fraudCheck: null };
  switch (rule.type) {
    case "transfer":
    case "approval":
      return rule;
    case "contract_call":
    case "value_message":
      return { ...rule, asset: null, amountMax: null, usdMax: null };
    default:
      return { ...rule, ...none };
  }
}

export function FraudCheckSelect({ rule, onChange, hint, t }: { rule: PolicyRuleBody; onChange: (r: PolicyRuleBody) => void; hint: string; t: T }) {
  return (
    <div>
      <label className="text-[10px] text-text-muted block mb-1">
        {t("policy.fraudCheck")} <span className="text-text-muted/50">({hint})</span>
      </label>
      <select
        value={rule.fraudCheck || ""}
        onChange={(e) => onChange({ ...rule, fraudCheck: (e.target.value || null) as PolicyRuleBody["fraudCheck"] })}
        className={INPUT}
      >
        <option value="">{t("policy.disabled")}</option>
        <option value="high">{t("policy.fraudHighDesc")}</option>
        <option value="medium">{t("policy.fraudMediumDesc")}</option>
        <option value="low">{t("policy.fraudLowDesc")}</option>
      </select>
    </div>
  );
}

function TextField({ label, hint, value, placeholder, mono, onChange }: {
  label: string; hint: string; value: string | null; placeholder: string; mono?: boolean; onChange: (v: string | null) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-text-muted block mb-1">
        {label} <span className="text-text-muted/50">({hint})</span>
      </label>
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={placeholder}
        className={`${INPUT}${mono ? " font-mono" : ""}`}
      />
    </div>
  );
}

/** Fields for transfer and approval rules. */
export function ValueRuleFields({ rule, onChange, t }: { rule: PolicyRuleBody; onChange: (r: PolicyRuleBody) => void; t: T }) {
  const isApproval = rule.type === "approval";
  return (
    <div className="space-y-2">
      {isApproval && <p className="text-[10px] text-text-muted leading-relaxed">{t("policy.approvalHint")}</p>}
      <TextField label={t("policy.asset")} hint={t("policy.assetHint")} value={rule.asset} placeholder="ETH, USDC, *, ..." onChange={(asset) => onChange({ ...rule, asset })} />
      <TextField label={t("policy.maxAmount")} hint={t("policy.unlimitedHint")} value={rule.amountMax} placeholder="1.0" onChange={(amountMax) => onChange({ ...rule, amountMax })} />
      <TextField label={t("policy.maxUsdValue")} hint={t("policy.unlimitedHint")} value={rule.usdMax} placeholder="100" onChange={(usdMax) => onChange({ ...rule, usdMax })} />
      <TextField
        label={isApproval ? t("policy.spender") : t("policy.toAddress")}
        hint={isApproval ? t("policy.spenderHint") : t("policy.toAddressHint")}
        value={rule.toAddress} placeholder="0x..." mono
        onChange={(toAddress) => onChange({ ...rule, toAddress })}
      />
      <FraudCheckSelect rule={rule} onChange={onChange} hint={t("policy.fraudCheckHint")} t={t} />
    </div>
  );
}

export function AccountControlWarning({ t }: { t: T }) {
  return <p className="text-[10px] text-red-400 leading-relaxed">{t("policy.accountControlWarning")}</p>;
}

/** Row summary for transfer / approval rules. */
export function ValueRuleSummary({ rule, t }: { rule: PolicyRuleBody; t: T }) {
  const isApproval = rule.type === "approval";
  return (
    <span>
      {isApproval ? t("policy.ruleApproval") : t("policy.ruleTransfer")}
      {rule.asset && <span className="text-text-muted"> asset={rule.asset}</span>}
      {rule.amountMax && <span className="text-text-muted"> max={rule.amountMax}</span>}
      {rule.usdMax && <span className="text-text-muted"> usd_max=${rule.usdMax}</span>}
      {rule.toAddress && (
        <span className="text-text-muted font-mono text-[10px]">
          {" "}{isApproval ? "spender" : "to"}={rule.toAddress.slice(0, 10)}…
        </span>
      )}
      {rule.fraudCheck && (
        <span className={`text-[10px] ${rule.fraudCheck === "low" ? "text-green-400" : rule.fraudCheck === "medium" ? "text-yellow-400" : "text-red-400"}`}> {"🛡️"} {rule.fraudCheck === "low" ? t("policy.fraudMax") : rule.fraudCheck === "medium" ? t("policy.fraudStrict") : t("policy.fraudStandard")}</span>
      )}
    </span>
  );
}
