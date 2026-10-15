// Modal shell for the home-level pickers (send: pick an asset, receive: pick a network).
// Bottom sheet on mobile, centered dialog on desktop; optional search field on top.

import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface PickerDialogProps {
  title: string;
  onClose: () => void;
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  children: ReactNode;
}

export function PickerDialog({ title, onClose, search, children }: PickerDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-surface-secondary border border-border-primary rounded-t-2xl md:rounded-2xl w-full md:max-w-sm shadow-xl max-h-[85dvh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {search && (
          <div className="px-4 pt-3">
            <input
              type="search"
              autoFocus
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              className="w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500"
            />
          </div>
        )}
        <div className="flex-1 overflow-y-auto py-2">{children}</div>
      </div>
    </div>
  );
}

/** One selectable row: icon, title + subtitle on the left, optional right-hand text. */
export function PickerRow({ icon, title, subtitle, right, onClick }: {
  icon?: string | null;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-tertiary/50 transition-colors"
    >
      {icon ? (
        <img src={icon} alt="" className="w-8 h-8 rounded-full bg-surface-tertiary shrink-0" />
      ) : (
        <div className="w-8 h-8 rounded-full bg-surface-tertiary shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{title}</p>
        {subtitle && <p className="text-[11px] text-text-muted truncate">{subtitle}</p>}
      </div>
      {right && <div className="text-right shrink-0">{right}</div>}
    </button>
  );
}
