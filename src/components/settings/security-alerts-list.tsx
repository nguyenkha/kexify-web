import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { timeAgo } from "../../lib/device-facts";
import { ErrorBox } from "../ui";
import { alertLine } from "../../lib/security-alert-text";
import { markAlertsRead } from "../../lib/security-alerts-api";
import { useSecurityAlerts } from "../../lib/use-security-alerts";

/** Settings > Security > Security alerts: one plain line per alert, newest first. */
export function SecurityAlertsList() {
  const { t, i18n } = useTranslation();
  const { alerts, unread, failed } = useSecurityAlerts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loaded = !!alerts;

  // Opened from the shell banner (/passkeys#security-alerts): scroll here once the list is on screen.
  useEffect(() => {
    if (loaded && window.location.hash === "#security-alerts") document.getElementById("security-alerts")?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (!alerts) return failed ? <p className="text-xs text-text-muted pt-6">{t("alerts.loadFailed")}</p> : null;

  async function readAll() {
    setBusy(true);
    setError("");
    try { await markAlertsRead(); } catch { setError(t("alerts.markReadFailed")); } finally { setBusy(false); }
  }

  return (
    <div id="security-alerts" className="space-y-3 pt-6">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{t("alerts.title")}</h2>
          <p className="text-xs text-text-muted mt-1">{t("alerts.description")}</p>
        </div>
        {unread > 0 && (
          <button
            onClick={readAll}
            disabled={busy}
            className="text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-border-primary disabled:opacity-60 shrink-0"
          >{t("alerts.markAllRead")}</button>
        )}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {alerts.length === 0 ? (
        <p className="text-xs text-text-muted">{t("alerts.empty")}</p>
      ) : (
        <div className="bg-surface-secondary rounded-lg border border-border-primary overflow-hidden divide-y divide-border-secondary">
          {alerts.map((a) => (
            <div key={a.id} className="px-3 md:px-5 py-2.5 flex items-start gap-2">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${a.readAt ? "bg-transparent" : "bg-blue-400"}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${a.readAt ? "text-text-secondary" : "text-text-primary font-medium"}`}>{alertLine(a, t, i18n.language)}</div>
                <div className="text-[11px] text-text-muted mt-0.5">{timeAgo(a.createdAt, i18n.language)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
