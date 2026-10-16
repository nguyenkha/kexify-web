// Send blocked by the daily limit, and the policy allows sends above it after a wait: offer to
// schedule this exact send. The owner is emailed; after the wait the same send signs once.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { activeSimplePolicy, scheduleSend, type ScheduledSend } from "../../lib/simple-policy-api";
import { mapCommonError } from "../../lib/error-message";

export function ScheduleSendOffer({ keyId, body }: { keyId: string; body: Record<string, unknown> }) {
  const { t } = useTranslation();
  const [waitHours, setWaitHours] = useState<number | null>(null);
  const [done, setDone] = useState<ScheduledSend | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    activeSimplePolicy(keyId).then((p) => {
      if (!live || !p || p.dailyLimitUsd === null) return;
      setWaitHours(p.overLimit === "wait_1h" ? 1 : p.overLimit === "wait_24h" ? 24 : null);
    });
    return () => { live = false; };
  }, [keyId]);

  if (waitHours === null) return null;
  return (
    <div className="mx-5 mb-4 rounded-xl border border-border-secondary bg-surface-primary px-3 py-3 space-y-2" data-testid="schedule-send-offer">
      <p className="text-sm font-semibold text-text-primary flex items-center gap-1.5"><Clock className="w-4 h-4" aria-hidden /> {t("simplePolicy.overLimitTitle")}</p>
      {done ? (
        <p className="text-xs text-green-700 dark:text-green-400">{t("simplePolicy.scheduledDone", { time: new Date(done.readyAt).toLocaleString() })}</p>
      ) : (
        <>
          <p className="text-xs text-text-secondary leading-relaxed">{t("simplePolicy.scheduleBody", { hours: waitHours })}</p>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              scheduleSend(keyId, body).then(setDone).catch((e) => setError(mapCommonError(e, t) ?? String(e.message))).finally(() => setBusy(false));
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white"
          >
            {t("simplePolicy.scheduleAction", { hours: waitHours })}
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
