// Tap-to-copy text (UX spec: common-states.md "Copy feedback").
// The text itself is the copy target, with a small muted copy icon next to it. On copy the icon
// turns into a check for 1.5 s, a light haptic fires and screen readers hear `common.copied`.
// No toast, and the text is never replaced. If the clipboard write fails, say so instead.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { haptic } from "../../lib/haptics";

interface CopyableTextProps {
  /** Value written to the clipboard. */
  value: string;
  /** What is shown; defaults to the value. Never truncated by this component. */
  children?: React.ReactNode;
  className?: string;
  /** Extra classes for the text span (e.g. font-mono, break-all). */
  textClassName?: string;
}

export function CopyableText({ value, children, className = "", textClassName = "" }: CopyableTextProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      haptic("success");
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("failed");
      timer.current = setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <span className={`inline-flex flex-col ${className}`}>
      <button
        type="button"
        onClick={copy}
        title={t("common.copy")}
        className="group inline-flex items-start gap-1.5 text-left hover:text-text-primary transition-colors"
      >
        <span className={`select-all ${textClassName}`}>{children ?? value}</span>
        {state === "copied" ? (
          <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-green-500" aria-hidden />
        ) : (
          <Copy className="w-3.5 h-3.5 shrink-0 mt-0.5 text-text-muted group-hover:text-text-tertiary" aria-hidden />
        )}
      </button>
      <span role="status" aria-live="polite" className={state === "failed" ? "text-[10px] text-red-400 mt-1" : "sr-only"}>
        {state === "copied" ? t("common.copied") : state === "failed" ? t("common.copyFailed") : ""}
      </span>
    </span>
  );
}
