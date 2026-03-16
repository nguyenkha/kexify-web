import { useState, useEffect } from "react";
import { authHeaders } from "../lib/auth";
import { apiUrl } from "../lib/apiBase";
import { useExpertMode } from "../context/ExpertModeContext";

interface AuditEntry {
  id: string;
  action: string;
  keyShareId?: string | null;
  keyName?: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** Actions to hide from the UI — internal steps not meaningful to users */
const HIDDEN_ACTIONS = new Set([
  "generate.init",
  "generate-eddsa.init",
  "generate-eddsa.complete",
  "sign.complete",
]);

// ── Icons (SVG components) ──────────────────────────────────

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  );
}

// ── Entry description ───────────────────────────────────────

interface EntryDesc {
  title: string;
  subtitle: string;    // shown collapsed — chain/amount/address at a glance
  detail: string;      // shown expanded — full explanation
  icon: (props: { className?: string }) => React.ReactNode;
  iconBg: string;
  iconColor: string;
}

function describeEntry(entry: AuditEntry): EntryDesc {
  const meta = entry.meta ?? {};
  const reason = meta.reason as string | undefined;
  const chainType = meta.chainType as string | undefined;
  const transfer = meta.transfer as Record<string, string> | undefined;

  switch (entry.action) {
    case "sign.init":
      return {
        title: "Transaction signed",
        subtitle: buildSubtitle(chainType, transfer, meta),
        detail: describeTransaction(meta),
        icon: SendIcon,
        iconBg: "bg-green-500/10",
        iconColor: "text-green-500",
      };
    case "sign.reject":
      return describeRejection(reason, meta);
    case "generate.complete":
      return {
        title: "Account created",
        subtitle: "",
        detail: "A new account was set up successfully.",
        icon: CheckIcon,
        iconBg: "bg-green-500/10",
        iconColor: "text-green-500",
      };
    case "backup.upload":
      return {
        title: "Backup saved",
        subtitle: "",
        detail: "Your encrypted key backup was uploaded.",
        icon: UploadIcon,
        iconBg: "bg-blue-500/10",
        iconColor: "text-blue-400",
      };
    case "backup.download":
      return {
        title: "Backup downloaded",
        subtitle: "",
        detail: "Your encrypted key backup was downloaded.",
        icon: DownloadIcon,
        iconBg: "bg-yellow-500/10",
        iconColor: "text-yellow-400",
      };
    case "server-share.hkdf-download":
      return {
        title: "Server share downloaded",
        subtitle: "",
        detail: "The server's key share was exported with encryption.",
        icon: DownloadIcon,
        iconBg: "bg-yellow-500/10",
        iconColor: "text-yellow-400",
      };
    case "server-share.export":
      return {
        title: "Self-custody export",
        subtitle: "",
        detail: "The server's key share was exported. You now have full self-custody.",
        icon: KeyIcon,
        iconBg: "bg-orange-500/10",
        iconColor: "text-orange-400",
      };
    default:
      return {
        title: entry.action,
        subtitle: "",
        detail: "",
        icon: CheckIcon,
        iconBg: "bg-surface-tertiary",
        iconColor: "text-text-muted",
      };
  }
}

function buildSubtitle(chainType?: string, transfer?: Record<string, string>, meta?: Record<string, unknown>): string {
  const parts: string[] = [];
  if (chainType) parts.push(chainType.toUpperCase());
  if (transfer) {
    const symbol = transfer.nativeSymbol || "";
    if (symbol) parts.push(symbol);
    if (transfer.to) parts.push(`to ${shortenAddress(transfer.to)}`);
  } else if (meta?.type === "raw_message") {
    parts.push("message signing");
  }
  return parts.join(" \u00b7 ");
}

function describeTransaction(meta: Record<string, unknown>): string {
  const chainType = meta.chainType as string | undefined;
  const transfer = meta.transfer as Record<string, string> | undefined;
  if (transfer) {
    const symbol = transfer.nativeSymbol || "tokens";
    return `Sent ${symbol} to ${shortenAddress(transfer.to)} on ${chainType?.toUpperCase() || "unknown chain"}.`;
  }
  if (meta.type === "raw_message") return "Signed a message.";
  return "Transaction initiated.";
}

function describeRejection(reason: string | undefined, meta: Record<string, unknown>): EntryDesc {
  const chainType = meta.chainType as string | undefined;
  const transfer = meta.transfer as Record<string, string> | undefined;
  const baseIcon = { icon: XIcon, iconBg: "bg-red-500/10", iconColor: "text-red-400" };

  switch (reason) {
    case "key_disabled":
      return {
        ...baseIcon,
        title: "Blocked \u2014 account disabled",
        subtitle: "",
        detail: "This transaction was rejected because your account is disabled. You can re-enable it in account settings.",
      };
    case "not_owner":
      return {
        ...baseIcon,
        title: "Blocked \u2014 unauthorized",
        subtitle: "",
        detail: "Someone tried to sign with your key from a different account.",
      };
    case "sighash_mismatch":
      return {
        ...baseIcon,
        title: "Blocked \u2014 invalid transaction",
        subtitle: "",
        detail: "The transaction data didn't match its hash. This could indicate tampering.",
      };
    case "unsupported_asset":
      return {
        ...baseIcon,
        title: "Blocked \u2014 unsupported token",
        subtitle: "",
        detail: "The token being transferred is not supported by this wallet.",
      };
    case "policy": {
      const fraudCheck = meta.fraudCheck as { flagged?: boolean; flags?: string[]; level?: string; address?: string } | undefined;
      if (fraudCheck?.flagged) {
        const flagLabels = (fraudCheck.flags || []).map(humanizeFlag).join(", ");
        return {
          icon: ShieldIcon,
          iconBg: "bg-red-500/10",
          iconColor: "text-red-400",
          title: "Blocked \u2014 risky address",
          subtitle: buildSubtitle(chainType, transfer, meta),
          detail: `The recipient address ${shortenAddress(fraudCheck.address || "")} was flagged for: ${flagLabels}. This is based on your fraud check setting (${levelLabel(fraudCheck.level)}).`,
        };
      }

      const priority = meta.rulePriority;
      if (priority === "default_deny") {
        return {
          ...baseIcon,
          title: "Blocked \u2014 no matching rule",
          subtitle: buildSubtitle(chainType, transfer, meta),
          detail: "No policy rule matched this transaction. By default, unmatched transactions are blocked. You can add a rule in Policy Rules settings.",
        };
      }
      return {
        ...baseIcon,
        title: "Blocked \u2014 policy rule",
        subtitle: buildSubtitle(chainType, transfer, meta),
        detail: `Your policy rule #${priority} blocked this transaction. You can adjust your rules in Policy Rules settings.`,
      };
    }
    default:
      return {
        ...baseIcon,
        title: "Transaction rejected",
        subtitle: "",
        detail: reason ? `Reason: ${reason}` : "This transaction was not approved.",
      };
  }
}

function humanizeFlag(flag: string): string {
  const labels: Record<string, string> = {
    sanctioned: "sanctioned entity",
    cybercrime: "cybercrime",
    stealing_attack: "theft/exploit",
    blackmail_activities: "blackmail",
    money_laundering: "money laundering",
    financial_crime: "financial crime",
    phishing_activities: "phishing",
    darkweb_transactions: "darkweb activity",
    mixer: "mixing service",
    honeypot_related_address: "honeypot related",
    malicious_mining_activities: "malicious mining",
  };
  return labels[flag] || flag.replace(/_/g, " ");
}

function levelLabel(level?: string): string {
  if (level === "high") return "Standard";
  if (level === "medium") return "Strict";
  if (level === "low") return "Maximum";
  return level || "unknown";
}

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ── Time formatting ─────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDateHeader(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - entryDate.getTime()) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function getDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── Entry Row ───────────────────────────────────────────────

function EntryRow({ entry, showAccount, expert }: { entry: AuditEntry; showAccount?: boolean; expert?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const desc = describeEntry(entry);
  const Icon = desc.icon;

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-3 flex items-start gap-3 hover:bg-surface-tertiary/50 transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${desc.iconBg}`}>
        <Icon className={`w-4 h-4 ${desc.iconColor}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary truncate">
            {desc.title}
          </span>
          <span
            className="text-[10px] text-text-muted shrink-0"
            title={new Date(entry.createdAt).toLocaleString()}
          >
            {formatTime(entry.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {showAccount && entry.keyName && (
            <span className="text-[10px] text-text-secondary">{entry.keyName}</span>
          )}
          {showAccount && entry.keyName && desc.subtitle && (
            <span className="text-[10px] text-text-muted/40">\u00b7</span>
          )}
          {desc.subtitle && (
            <span className="text-[10px] text-text-muted font-mono truncate">{desc.subtitle}</span>
          )}
          {expert && (
            <span className="text-[10px] text-text-muted/40 font-mono">{entry.action}</span>
          )}
        </div>
        {expanded && desc.detail && (
          <p className="text-[11px] text-text-muted mt-2 leading-relaxed bg-surface-primary/50 rounded-lg px-2.5 py-2 border border-border-secondary">
            {desc.detail}
          </p>
        )}
        {expanded && expert && entry.meta && Object.keys(entry.meta).length > 0 && (
          <pre className="text-[10px] text-text-muted font-mono mt-1.5 bg-surface-primary/50 rounded-lg px-2.5 py-2 border border-border-secondary overflow-auto max-h-40 leading-relaxed">
            {JSON.stringify(entry.meta, null, 2)}
          </pre>
        )}
      </div>
    </button>
  );
}

// ── Page Component ──────────────────────────────────────────

/** Full-page activity log for all accounts (used in Advanced menu) */
export function ActivityLogPage() {
  const expert = useExpertMode();
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    fetchLogs(1);
  }, []);

  async function fetchLogs(p: number) {
    setLoading(true);
    const res = await fetch(apiUrl(`/api/account/audit?page=${p}&limit=20`), {
      headers: authHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      if (p === 1) {
        setLogs(data.logs);
      } else {
        setLogs((prev) => [...prev, ...data.logs]);
      }
      setHasMore(data.hasMore);
      setPage(p);
    }
    setLoading(false);
  }

  const filtered = expert ? logs : logs.filter((e) => !HIDDEN_ACTIONS.has(e.action));

  // Group by date
  const groups: { dateKey: string; label: string; entries: AuditEntry[] }[] = [];
  for (const entry of filtered) {
    const key = getDateKey(entry.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === key) {
      last.entries.push(entry);
    } else {
      groups.push({ dateKey: key, label: formatDateHeader(entry.createdAt), entries: [entry] });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Activity Log</h2>
        <p className="text-xs text-text-muted mt-1">
          Signing activity, security events, and policy blocks across all accounts.
        </p>
      </div>

      {loading && logs.length === 0 ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-3 py-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-surface-tertiary shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 bg-surface-tertiary rounded" />
                <div className="h-2.5 w-48 bg-surface-tertiary/60 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-xs text-text-muted">No activity yet</p>
          <p className="text-[10px] text-text-muted/60 mt-1">
            Activity will appear here after you sign transactions or make account changes.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.dateKey}>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-1.5 px-1">
                {group.label}
              </p>
              <div className="bg-surface-secondary rounded-xl border border-border-primary overflow-hidden divide-y divide-border-secondary">
                {group.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} showAccount expert={expert} />
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              onClick={() => fetchLogs(page + 1)}
              disabled={loading}
              className="w-full text-xs text-blue-400 hover:text-blue-300 py-2.5 rounded-lg border border-dashed border-border-primary hover:border-blue-500/30 transition-colors disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
