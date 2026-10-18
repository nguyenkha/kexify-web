// Review header: dApp (icon, name, domain) or a plain title, with the network as a small chip.
// Replaces the old "Network" row and "Sign transaction" section titles.

import { BadgeCheck } from "lucide-react";

export function NetworkChip({ name, iconUrl }: { name: string; iconUrl?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full bg-surface-tertiary px-2 py-1 text-[11px] font-semibold text-text-secondary">
      {iconUrl ? <img src={iconUrl} alt="" className="w-3.5 h-3.5 rounded-full" /> : <span className="w-2 h-2 rounded-full bg-blue-500" aria-hidden />}
      {name}
    </span>
  );
}

interface DappProps {
  name: string;
  url?: string;
  iconUrl?: string;
  verified?: boolean;
}

export function DappTitle({ name, url, iconUrl, verified }: DappProps) {
  let host = url ?? "";
  try {
    if (url) host = new URL(url).host;
  } catch { /* keep the raw url */ }
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      {iconUrl ? (
        <img src={iconUrl} alt="" className="w-9 h-9 rounded-lg bg-surface-tertiary object-cover shrink-0" />
      ) : (
        <span className="w-9 h-9 rounded-lg bg-surface-tertiary text-text-secondary shrink-0 inline-flex items-center justify-center text-sm font-semibold" aria-hidden>
          {(name.trim()[0] ?? "?").toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-primary flex items-center gap-1 truncate">
          <span className="truncate">{name}</span>
          {verified && <BadgeCheck className="w-4 h-4 text-green-500 shrink-0" aria-hidden />}
        </p>
        {host && <p className="text-xs text-text-muted truncate">{host}</p>}
      </div>
    </div>
  );
}
