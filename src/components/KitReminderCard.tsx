import { useTranslation } from "react-i18next";

/** Onboarding "Ready" step card (UX spec: onboarding-create-wallet.md step 5): back up now or later. */
export function KitReminderCard({ onBackUpNow }: { onBackUpNow: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg px-4 py-3 text-left space-y-2.5">
      <div>
        <p className="text-xs font-medium text-yellow-500">{t("backup.backUpYourWallet")}</p>
        <p className="text-[11px] text-yellow-500/70 leading-relaxed mt-0.5">{t("protection.notMandatory")}</p>
      </div>
      <button
        onClick={onBackUpNow}
        className="w-full bg-surface-tertiary hover:bg-border-primary text-text-primary px-4 py-2 rounded-lg text-xs font-medium transition-colors"
      >
        {t("backup.backUpNow")}
      </button>
    </div>
  );
}
