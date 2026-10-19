import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Smartphone } from "lucide-react";
import { apiUrl } from "../../lib/apiBase";
import { authHeaders } from "../../lib/auth";
import { getSignerRecord } from "../../lib/device-signer-key";
import { signerErrorMessage } from "../../lib/signer-error-message";
import { activateSigner, listSigners, revokeSigner, SignerApiError, type SignerRow } from "../../lib/signer-api";
import { ErrorBox } from "../ui";

interface Wallet { id: string; name: string | null; signers: SignerRow[] }

function timeAgo(iso: string, lang: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (!Number.isFinite(mins)) return "";
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  return Math.abs(hours) < 24 ? rtf.format(hours, "hour") : rtf.format(Math.round(hours / 24), "day");
}

async function loadWallets(): Promise<{ wallets: Wallet[]; mine: Map<string, { id?: string; active: boolean }> }> {
  const res = await fetch(apiUrl("/api/keys"), { headers: authHeaders() });
  if (!res.ok) throw new Error(`keys ${res.status}`);
  const keys = ((await res.json()).keys ?? []) as Array<{ id: string; name: string | null; enabled?: boolean }>;
  const mine = new Map<string, { id?: string; active: boolean }>();
  const wallets: Wallet[] = [];
  await Promise.all(keys.filter((k) => k.enabled !== false).map(async (k) => {
    try {
      const signers = await listSigners(k.id); // refreshes the local state too
      const rec = await getSignerRecord(k.id);
      mine.set(k.id, { id: rec?.signerId, active: rec?.status === "active" });
      wallets.push({ id: k.id, name: k.name, signers });
    } catch { /* cold vault or no signer support: not listed */ }
  }));
  return { wallets: keys.map((k) => wallets.find((w) => w.id === k.id)).filter((w): w is Wallet => !!w), mine };
}

/** Settings > Security > Signing devices: one signing device per wallet; the others view only. */
export function SignersList() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadWallets>> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ keyId: string; signerId: string } | null>(null);

  const load = useCallback(async () => {
    try { setData(await loadWallets()); } catch { setError(t("signers.loadFailed")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await fn(); setConfirm(null); await load(); } catch (err) { setError(signerErrorMessage(err, t)); } finally { setBusy(false); }
  }

  async function remove(keyId: string, signerId: string, confirmLast = false) {
    const me = data?.mine.get(keyId);
    setBusy(true);
    setError("");
    try {
      await revokeSigner(keyId, signerId, { viaDevice: !!me?.active && me.id === signerId, confirmLast });
      setConfirm(null);
      await load();
    } catch (err) {
      if (err instanceof SignerApiError && err.code === "LAST_SIGNER_CONFIRM") setConfirm({ keyId, signerId });
      else if (err instanceof SignerApiError && err.code === "LAST_SIGNER_NO_BACKUP") { setConfirm(null); setError(t("signers.removeLast.noBackup")); }
      else setError(signerErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!data || data.wallets.length === 0) return error ? <ErrorBox>{error}</ErrorBox> : null;
  const btn = "text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-60 bg-surface-tertiary text-text-secondary hover:bg-border-primary shrink-0";

  return (
    <div className="space-y-4 pt-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{t("signers.title")}</h2>
        <p className="text-xs text-text-muted mt-1">{t("signers.description")}</p>
      </div>
      {data.wallets.map((w) => (
        <div key={w.id} className="space-y-1.5">
          {data.wallets.length > 1 && <div className="text-xs font-medium text-text-secondary">{w.name || w.id.slice(0, 8)}</div>}
          <div className="bg-surface-secondary rounded-lg border border-border-primary overflow-hidden divide-y divide-border-secondary">
            {w.signers.map((s) => {
              const Icon = s.kind === "ios_se" ? Smartphone : Globe;
              const me = data.mine.get(w.id);
              const isMe = me?.id === s.id;
              const badge = s.status === "active" ? ["bg-green-500/10 text-green-400", t("signers.device.signing")]
                : s.status === "pending" ? ["bg-yellow-500/10 text-yellow-400", t("signers.device.viewOnly")]
                : ["bg-red-500/10 text-red-400", t("signers.removed")];
              return (
                <div key={s.id} className="px-3 md:px-5 py-2">
                  <div className="flex items-center min-h-[56px]">
                    <div className="w-9 h-9 rounded-full bg-surface-tertiary flex items-center justify-center shrink-0 mr-3"><Icon className="w-4 h-4 text-text-muted" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-text-primary truncate">{s.label || t("signers.device.unnamed")}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badge[0]}`}>{badge[1]}</span>
                        {isMe && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 shrink-0">{t("signers.thisDevice")}</span>}
                      </div>
                      <div className="text-[11px] text-text-muted mt-0.5">
                        {s.lastUsedAt ? t("signers.lastUsed", { time: timeAgo(s.lastUsedAt, i18n.language) }) : t("signers.never")}
                      </div>
                    </div>
                    {s.status === "pending" && (
                      <button className={btn} disabled={busy} onClick={() => run(() => activateSigner(w.id, s.id, !!me?.active))}>
                        {isMe ? t("signers.useThis") : t("signers.makeSigning")}
                      </button>
                    )}
                    {s.status !== "revoked" && (
                      <button className={`${btn} ml-2`} disabled={busy} onClick={() => remove(w.id, s.id)}>{t("signers.remove")}</button>
                    )}
                  </div>
                  {confirm?.keyId === w.id && confirm.signerId === s.id && (
                    <div className="pb-2 space-y-2">
                      <p className="text-xs text-text-muted">{t("signers.removeLast.confirm")}</p>
                      <div className="flex gap-2">
                        <button className={btn} disabled={busy} onClick={() => setConfirm(null)}>{t("signers.cancel")}</button>
                        <button className={`${btn} !bg-red-500/10 !text-red-400`} disabled={busy} onClick={() => remove(w.id, s.id, true)}>{t("signers.confirmRemove")}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
