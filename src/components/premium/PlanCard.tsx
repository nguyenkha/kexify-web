// Settings → Plan: Free / Premium state, source (Apple or stablecoin), and the way into the paywall.
// Shown for email and standalone (anonymous) wallets alike. No feature gating yet.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Crown } from "lucide-react";
import { Button } from "../ui";
import { getEntitlement, type EntitlementInfo } from "../../lib/premium-api";
import { PremiumPaywall } from "./PremiumPaywall";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

export function PlanCard() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<EntitlementInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [paywall, setPaywall] = useState(false);

  const load = useCallback(async () => {
    const r = await getEntitlement();
    if (r.ok) { setInfo(r.data); setFailed(false); } else setFailed(true);
  }, []);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  if (failed) return null; // optional card: a failed read must never block Settings
  const ent = info?.entitlement;
  const premium = ent?.plan === "premium";
  const source = ent?.apple && ent.crypto ? "both" : ent?.apple ? "apple" : ent?.crypto ? "crypto" : null;
  const status = !ent ? "" : ent.state === "active" ? t("premium.plan.active", { date: fmt(ent.expiresAt) })
    : ent.state === "grace" ? t("premium.plan.grace", { date: fmt(ent.graceUntil) })
    : ent.state === "expired" ? t("premium.plan.expired", { date: fmt(ent.expiresAt) })
    : t("premium.plan.freeDesc");

  return (
    <div>
      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-2 px-1">{t("premium.plan.section")}</p>
      <div className="bg-surface-secondary rounded-lg border border-border-primary px-3 md:px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary flex items-center gap-1.5">
              <Crown className={`w-4 h-4 ${premium ? "text-yellow-500" : "text-text-muted"}`} />
              {premium ? t("premium.plan.premium") : t("premium.plan.free")}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{status}</p>
            {source && <p className="text-xs text-text-muted mt-0.5">{t(`premium.plan.source.${source}`)}</p>}
            {ent?.apple && <p className="text-xs text-text-muted mt-0.5">{t("premium.plan.manageApple")}</p>}
          </div>
          {info && (
            <Button size="sm" variant={premium ? "secondary" : "primary"} onClick={() => setPaywall(true)}>
              {premium ? t("premium.plan.extend") : t("premium.plan.get")}
            </Button>
          )}
        </div>
      </div>
      {paywall && info && <PremiumPaywall info={info} onClose={() => setPaywall(false)} onPaid={() => void load()} />}
    </div>
  );
}
