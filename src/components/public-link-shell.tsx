import type { ReactNode } from "react";

/** Centered card for the public pages that alert emails link to (no login needed). */
export function PublicLinkShell({ tone, title, body, children }: { tone: "warn" | "ok" | "error"; title: string; body?: string; children?: ReactNode }) {
  const color = tone === "ok" ? "bg-green-500/10 text-green-400" : tone === "warn" ? "bg-yellow-500/10 text-yellow-400" : "bg-red-500/10 text-red-400";
  return (
    <div className="min-h-dvh bg-surface-primary flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center">
        <h1 className="text-3xl font-bold tracking-tight text-text-primary mb-1">kexify</h1>
        <p className="text-[11px] text-text-muted mb-6">keys simplified</p>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${color}`}>
          <span className="text-xl font-bold">{tone === "ok" ? "✓" : "!"}</span>
        </div>
        <p className="text-sm font-medium text-text-primary mb-2">{title}</p>
        {body && <p className="text-xs text-text-muted mb-6 leading-relaxed">{body}</p>}
        {children}
      </div>
    </div>
  );
}
