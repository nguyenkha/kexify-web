import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { KeyShare } from "../shared/types";

export function DisabledKeyRow({
  keyShare,
  onToggle,
  onCancelEnable,
  frozen,
}: {
  keyShare: KeyShare;
  onToggle: (id: string, enabled: boolean) => void;
  onCancelEnable?: (id: string) => void;
  frozen?: boolean;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  function formatCountdown(enableAt: string): string {
    const diff = new Date(enableAt).getTime() - now;
    if (diff <= 0) return t("disabledKey.enablingSoon");
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return t("disabledKey.reEnablesIn", { time: `${h}h ${m}m` });
  }

  // Refresh countdown every 30s while enableAt is set
  useEffect(() => {
    if (!keyShare.enableAt) return;
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [keyShare.enableAt]);

  return (
    <div className="flex items-center h-14 px-3 md:px-5 opacity-40 hover:opacity-60 transition-opacity">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-full bg-surface-tertiary flex items-center justify-center shrink-0">
          <svg
            className="w-4 h-4 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <div>
          <span className="text-sm text-text-tertiary">
            {keyShare.name || <span className="font-mono">{keyShare.id.slice(0, 8)}...</span>}
          </span>
          <p className="text-[10px] text-text-muted">
            {keyShare.enableAt ? (
              <span className="text-yellow-400/70">{formatCountdown(keyShare.enableAt)}</span>
            ) : (
              t("disabledKey.disabled")
            )}
          </p>
        </div>
      </div>
      {keyShare.enableAt ? (
        <button
          onClick={() => onCancelEnable?.(keyShare.id)}
          disabled={frozen}
          className="text-xs text-text-muted hover:text-red-400 px-3 py-1.5 rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-text-muted disabled:hover:bg-transparent"
        >
          {t("disabledKey.cancel")}
        </button>
      ) : (
        <button
          onClick={() => onToggle(keyShare.id, true)}
          disabled={frozen}
          className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1.5 rounded-md hover:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-blue-400 disabled:hover:bg-transparent"
        >
          {t("disabledKey.enable")}
        </button>
      )}
    </div>
  );
}
