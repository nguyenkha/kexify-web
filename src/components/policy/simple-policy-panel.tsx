// Policy screen, simple mode: summary of the 3 settings, editor, and submit through the normal
// flow (passkey per change; looser = 24 h cooling, tighter = applies at once, decided server-side).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PasskeyChallenge } from "../PasskeyChallenge";
import { rulesSha256, sensitiveHeaders, type PasskeyAction } from "../../lib/passkey";
import { apiUrl } from "../../lib/apiBase";
import { mapCommonError } from "../../lib/error-message";
import {
  cancelScheduledSend, compileSimplePolicy, listScheduledSends,
  type CompiledPolicy, type ScheduledSend, type SimplePolicy,
} from "../../lib/simple-policy-api";
import { isSimplePolicyValid, SimplePolicyForm } from "./simple-policy-form";

export function SimplePolicySummary({ value }: { value: SimplePolicy }) {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t("simplePolicy.dailyLimit"), value.dailyLimitUsd === null ? t("simplePolicy.noLimit") : `$${value.dailyLimitUsd}`],
    [t("simplePolicy.sendTo"), value.sendTo === "anywhere" ? t("simplePolicy.sendTo_anywhere") : t("simplePolicy.trustedCount", { count: value.trusted.length })],
  ];
  if (value.dailyLimitUsd !== null) rows.push([t("simplePolicy.overLimit"), t(`simplePolicy.overLimit_${value.overLimit}`)]);
  return (
    <dl className="divide-y divide-border-secondary rounded-xl border border-border-secondary bg-surface-primary">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 px-3 py-2.5 text-sm">
          <dt className="text-text-secondary">{k}</dt>
          <dd className="text-text-primary font-medium text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * `initial`: the settings to start editing from (active simple settings, or the defaults when
 * the wallet is Custom and the user takes the suggestion). `onDone` re-reads the policy.
 */
export function SimplePolicyEditor({ keyId, initial, replacesCustom = 0, onCancel, onDone }: {
  keyId: string; initial: SimplePolicy;
  /** > 0: the wallet is on a Custom policy with this many rules, which saving replaces. */
  replacesCustom?: number;
  onCancel: () => void; onDone: (applied: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SimplePolicy>(initial);
  const [compiled, setCompiled] = useState<CompiledPolicy | null>(null);
  const [passkey, setPasskey] = useState<PasskeyAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Compile on every valid change: the preview says whether it applies now or in 24 h.
  useEffect(() => {
    setCompiled(null);
    if (!isSimplePolicyValid(draft)) return;
    let live = true;
    const h = setTimeout(() => {
      compileSimplePolicy(keyId, draft).then((c) => live && setCompiled(c)).catch((e) => live && setError(mapCommonError(e, t) ?? String(e.message)));
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [keyId, draft, t]);

  async function submit(ticket?: string) {
    if (!compiled) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiUrl(`/api/keys/${keyId}/rules/pending`), { method: "POST", headers: sensitiveHeaders(ticket), body: JSON.stringify({ rules: compiled.rules }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "");
      onDone(data.applied === true);
    } catch (e) {
      setError(mapCommonError(e, t) ?? t("policy.submitFailed"));
    }
    setBusy(false);
  }

  if (passkey) {
    return <PasskeyChallenge action={passkey} onAuthenticated={(r) => { setPasskey(null); submit(r.token); }} onCancel={() => setPasskey(null)} />;
  }
  return (
    <div className="space-y-4">
      {replacesCustom > 0 && (
        <p className="text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-700 dark:text-amber-400">{t("simplePolicy.replacesCustom", { count: replacesCustom })}</p>
      )}
      <SimplePolicyForm value={draft} onChange={(v) => { setError(""); setDraft(v); }} t={t} />
      {compiled && (
        <p className={`text-xs rounded-lg px-3 py-2 ${compiled.immediate ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
          {compiled.immediate ? t("simplePolicy.appliesNow") : t("simplePolicy.appliesIn24h")}
        </p>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-xs px-3 py-2 rounded-lg text-text-tertiary hover:bg-surface-tertiary">{t("common.cancel")}</button>
        <button
          disabled={!compiled || busy}
          onClick={async () => compiled && setPasskey({ action: "policy.set", keyShareId: keyId, rulesSha256: await rulesSha256(compiled.rules) })}
          className="text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium"
        >
          {busy ? t("policy.submitting") : t("simplePolicy.save")}
        </button>
      </div>
    </div>
  );
}

/** Open scheduled sends above the daily limit, with cancel (always allowed). */
export function ScheduledSendsList({ keyId }: { keyId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ScheduledSend[] | null>(null);
  const load = () => listScheduledSends(keyId).then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, [keyId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-text-muted uppercase tracking-wide">{t("simplePolicy.scheduled")}</p>
      {items.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border-secondary px-3 py-2 text-xs">
          <div className="min-w-0">
            <p className="text-text-primary truncate">{s.summary?.amount} {s.summary?.symbol ?? ""} → <span className="font-mono">{s.summary?.to}</span></p>
            <p className="text-text-muted">{t("simplePolicy.readyAt", { time: new Date(s.readyAt).toLocaleString() })}</p>
          </div>
          <button onClick={() => cancelScheduledSend(keyId, s.id).then(load)} className="text-red-500 hover:underline shrink-0">{t("common.cancel")}</button>
        </div>
      ))}
    </div>
  );
}
