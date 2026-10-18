import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Smartphone, Terminal } from "lucide-react";
import { apiUrl } from "../../lib/apiBase";
import { authHeaders, signOut } from "../../lib/auth";
import { fetchWithPasskey } from "../../lib/passkey";
import { passkeyErrorMessage } from "../../lib/passkey-error-message";
import { ErrorBox } from "../ui";

export interface SessionInfo {
  id: string;
  platform: "web" | "ios" | "cli";
  deviceLabel: string | null;
  country: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

const ICONS = { web: Globe, ios: Smartphone, cli: Terminal } as const;

/** "5 minutes ago" in the UI language. */
function timeAgo(iso: string, lang: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (!Number.isFinite(mins)) return "";
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (Math.abs(mins) < 60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

async function fetchSessions(): Promise<SessionInfo[]> {
  const res = await fetch(apiUrl("/api/sessions"), { headers: authHeaders() });
  if (res.status === 401) {
    // Same as a failed /auth/refresh: this login is over.
    const code = (await res.clone().json().catch(() => ({})))?.code;
    if (code === "session_revoked" || code === "session_required") signOut({ sessionEnded: true });
  }
  if (!res.ok) throw new Error(`sessions ${res.status}`);
  const data = await res.json();
  return (data.sessions ?? []) as SessionInfo[];
}

/** Settings > Passkeys & devices: this account's logged-in sessions. Other sessions are ended with a passkey tap. */
export function SessionsList({ hasPasskeys = true }: { hasPasskeys?: boolean }) {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setSessions(await fetchSessions());
    } catch {
      setError(t("sessions.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithPasskey(apiUrl(`/api/sessions/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: authHeaders(),
      }, { action: "session.revoke", sessionId: id });
      if (!res.ok) throw new Error(t("sessions.revokeFailed"));
      await load();
    } catch (err) {
      setError(passkeyErrorMessage(err, t));
    } finally {
      setBusy(false);
      setConfirmingId(null);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithPasskey(apiUrl("/api/sessions/revoke-others"), {
        method: "POST",
        headers: authHeaders(),
      }, { action: "session.revoke-others" });
      if (!res.ok) throw new Error(t("sessions.revokeFailed"));
      await load();
    } catch (err) {
      setError(passkeyErrorMessage(err, t));
    } finally {
      setBusy(false);
      setConfirmingAll(false);
    }
  }

  if (loading) return null;
  if (sessions.length === 0 && !error) return null;
  const others = sessions.filter((s) => !s.current);
  const btn = "text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-60";

  return (
    <div className="space-y-4 pt-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{t("sessions.title")}</h2>
        <p className="text-xs text-text-muted mt-1">{t("sessions.description")}</p>
      </div>

      <div className="bg-surface-secondary rounded-lg border border-border-primary overflow-hidden divide-y divide-border-secondary">
        {sessions.map((s) => {
          const Icon = ICONS[s.platform] ?? Globe;
          return (
            <div key={s.id} className="flex items-center min-h-[68px] px-3 md:px-5 py-2">
              <div className="w-9 h-9 rounded-full bg-surface-tertiary flex items-center justify-center shrink-0 mr-3">
                <Icon className="w-4 h-4 text-text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary truncate">
                    {s.deviceLabel || t(`sessions.platform.${s.platform}`)}
                  </span>
                  {s.current && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 shrink-0">{t("sessions.thisDevice")}</span>
                  )}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {[s.country, t("sessions.lastActive", { when: timeAgo(s.lastSeenAt, i18n.language) })].filter(Boolean).join(" · ")}
                </div>
              </div>
              {!s.current && hasPasskeys && (confirmingId === s.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setConfirmingId(null)} disabled={busy} className={`${btn} bg-surface-tertiary text-text-secondary hover:bg-border-primary`}>{t("sessions.cancel")}</button>
                  <button onClick={() => revoke(s.id)} disabled={busy} className={`${btn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>{busy ? t("sessions.signingOut") : t("sessions.signOut")}</button>
                </div>
              ) : (
                <button onClick={() => setConfirmingId(s.id)} disabled={busy} className={`${btn} bg-surface-tertiary text-text-secondary hover:bg-border-primary shrink-0`}>{t("sessions.signOut")}</button>
              ))}
            </div>
          );
        })}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {others.length > 0 && !hasPasskeys && (
        <p className="text-xs text-text-muted">{t("sessions.needPasskey")}</p>
      )}

      {others.length > 0 && hasPasskeys && (confirmingAll ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted flex-1">{t("sessions.signOutOthersConfirm")}</span>
          <button onClick={() => setConfirmingAll(false)} disabled={busy} className={`${btn} bg-surface-tertiary text-text-secondary hover:bg-border-primary`}>{t("sessions.cancel")}</button>
          <button onClick={revokeOthers} disabled={busy} className={`${btn} bg-red-500/10 text-red-400 hover:bg-red-500/20`}>{busy ? t("sessions.signingOut") : t("sessions.signOutOthers")}</button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmingAll(true)}
          disabled={busy}
          className="w-full border border-dashed border-border-primary rounded-lg py-3 text-sm text-text-muted hover:text-text-secondary hover:border-border-secondary transition-colors disabled:opacity-60"
        >
          {t("sessions.signOutOthers")}
        </button>
      ))}
    </div>
  );
}
