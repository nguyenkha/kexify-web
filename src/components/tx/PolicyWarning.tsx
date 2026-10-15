// Shared policy pre-check warning banner for Send/WC preview

import { useTranslation } from "react-i18next";
import { PolicyBlockedNotice } from "./PolicyBlockedNotice";
import { policyBlockReason } from "../send/send-error";

interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  /** Which part of the transaction the policy blocked (approval, account_control, unknown, fee, ...). */
  blockedLeg?: string | null;
  fraudCheck?: { flagged: boolean; flags: string[]; level: string; address: string };
}

export function PolicyWarning({ policyCheck, onReviewPolicy }: {
  policyCheck: PolicyCheckResult | null;
  /** Shows a "Review policy rules" link on a policy block. */
  onReviewPolicy?: () => void;
}) {
  const { t } = useTranslation();
  if (!policyCheck || policyCheck.allowed) return null;

  if (!policyCheck.fraudCheck?.flagged) {
    // The server reason is English; the leg maps to a localised reason instead.
    return <PolicyBlockedNotice reason={policyBlockReason(policyCheck.blockedLeg, t)} onReviewPolicy={onReviewPolicy} />;
  }

  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
      <p className="text-xs font-medium text-red-400">
        {`🛡️ ${t("send.riskyAddress")}`}
      </p>
      <p className="text-[11px] text-red-400/80 mt-1 leading-relaxed">
        {t("send.fraudFlagDesc", { flags: policyCheck.fraudCheck.flags.map(f => f.replace(/_/g, " ")).join(", ") })}
      </p>
    </div>
  );
}
