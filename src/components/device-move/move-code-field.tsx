import { useState } from "react";
import { useTranslation } from "react-i18next";

/** "Type the code shown on your old device": 6 digits, spaces allowed while typing. */
export function MoveCodeField({ onSubmit }: { onSubmit: (code: string) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const code = value.replace(/\D/g, "");
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) onSubmit(code); }}>
      <label className="block text-xs text-text-muted">{t("move.qr.code")}</label>
      <div className="flex gap-2">
        <input
          value={value} onChange={(e) => setValue(e.target.value.slice(0, 7))} inputMode="numeric" autoComplete="one-time-code"
          className="flex-1 min-w-0 text-center tracking-widest font-mono text-sm px-3 py-2 rounded-lg bg-surface-primary border border-border-primary text-text-primary"
          placeholder="000 000"
        />
        <button type="submit" disabled={code.length !== 6} className="text-xs px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">{t("move.qr.submit")}</button>
      </div>
    </form>
  );
}
