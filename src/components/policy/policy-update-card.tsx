// One-time suggestion for wallets on a Custom (or legacy) policy: move to the simple 3-setting
// policy. Taking it goes through the normal change flow (passkey; looser = 24 h cooling), so an
// existing wallet is never loosened automatically.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { dismissUpdateCard, isUpdateCardDismissed } from "../../lib/simple-policy-api";

export function PolicyUpdateCard({ keyId, onUpdate }: { keyId: string; onUpdate: () => void }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => isUpdateCardDismissed(keyId));
  if (hidden) return null;
  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 px-3 py-3 space-y-2" data-testid="policy-update-card">
      <p className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
        <Sparkles className="w-4 h-4 text-blue-500" aria-hidden /> {t("simplePolicy.cardTitle")}
      </p>
      <p className="text-xs text-text-secondary leading-relaxed">{t("simplePolicy.cardBody")}</p>
      <div className="flex gap-2">
        <button onClick={onUpdate} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white">{t("simplePolicy.cardAction")}</button>
        <button onClick={() => { dismissUpdateCard(keyId); setHidden(true); }} className="text-xs px-3 py-1.5 rounded-lg text-text-tertiary hover:bg-surface-tertiary">{t("simplePolicy.cardLater")}</button>
      </div>
    </div>
  );
}
