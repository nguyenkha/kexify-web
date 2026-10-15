import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

interface ConfirmDialogProps {
  open: boolean;
  message: ReactNode;
  confirmLabel: string;
  /** Red confirm button for destructive actions */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small modal confirm (replaces window.confirm). Escape / backdrop click cancels. */
export function ConfirmDialog({ open, message, confirmLabel, destructive, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; });

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm bg-surface-secondary border border-border-primary rounded-xl p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-text-primary leading-relaxed">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="bg-surface-tertiary hover:bg-border-primary text-text-secondary text-xs px-3 py-1.5 font-medium rounded-lg transition-colors"
          >
            {t("common.cancel")}
          </button>
          <Button variant={destructive ? "danger" : "primary"} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
