import { useTranslation } from "react-i18next";
import { setThemePreference, useThemePreference, type ThemePreference } from "../lib/theme";

const OPTIONS: { value: ThemePreference; labelKey: string }[] = [
  { value: "system", labelKey: "theme.system" },
  { value: "light", labelKey: "theme.light" },
  { value: "dark", labelKey: "theme.dark" },
];

/** Settings > Preferences > Theme: System (default) / Light / Dark. */
export function ThemeSelector() {
  const { t } = useTranslation();
  const current = useThemePreference();

  return (
    <div className="px-3 md:px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-text-primary">{t("config.theme")}</p>
        <div role="radiogroup" aria-label={t("config.theme")} className="flex bg-surface-primary border border-border-primary rounded-lg p-0.5 gap-0.5">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={current === o.value}
              onClick={() => setThemePreference(o.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                current === o.value
                  ? "bg-surface-tertiary text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
