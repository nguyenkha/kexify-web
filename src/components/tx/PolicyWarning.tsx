// Shared policy pre-check warning banner for Send/WC preview

interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  fraudCheck?: { flagged: boolean; flags: string[]; level: string; address: string };
}

export function PolicyWarning({ policyCheck }: { policyCheck: PolicyCheckResult | null }) {
  if (!policyCheck || policyCheck.allowed) return null;

  return (
    <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
      <p className="text-xs font-medium text-red-400">
        {policyCheck.fraudCheck?.flagged
          ? "\uD83D\uDEE1\uFE0F Risky address detected"
          : "\u26D4 Blocked by policy"}
      </p>
      <p className="text-[11px] text-red-400/80 mt-1 leading-relaxed">
        {policyCheck.fraudCheck?.flagged
          ? `This address has been flagged for: ${policyCheck.fraudCheck.flags.map(f => f.replace(/_/g, " ")).join(", ")}. The transaction will be rejected by your policy.`
          : policyCheck.reason || "This transaction does not match any allow rule in your policy."}
      </p>
    </div>
  );
}
