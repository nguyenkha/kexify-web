// Shared policy pre-check warning banner for Send/WC preview

import { useTranslation } from "react-i18next";

interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  fraudCheck?: { flagged: boolean; flags: string[]; level: string; address: string };
}

export function PolicyWarning({ policyCheck }: { policyCheck: PolicyCheckResult | null }) {
  const { t } = useTranslation();
  if (!policyCheck || policyCheck.allowed) return null;

  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
      <p className="text-xs font-medium text-red-400">
        {policyCheck.fraudCheck?.flagged
          ? `\uD83D\uDEE1\uFE0F ${t("send.riskyAddress")}`
          : `\u26D4 ${t("send.blockedByPolicy")}`}
      </p>
      <p className="text-[11px] text-red-400/80 mt-1 leading-relaxed">
        {policyCheck.fraudCheck?.flagged
          ? t("send.fraudFlagDesc", { flags: policyCheck.fraudCheck.flags.map(f => f.replace(/_/g, " ")).join(", ") })
          : policyCheck.reason || t("send.policyBlockedDefault")}
      </p>
    </div>
  );
}
