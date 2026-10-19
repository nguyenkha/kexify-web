import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useSecurityAlerts } from "../lib/use-security-alerts";

/** App shell: a one-line banner while there are unread security alerts. Hidden on the page that lists them. */
export function SecurityAlertsBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { unread } = useSecurityAlerts();
  if (unread <= 0 || pathname === "/passkeys") return null;

  return (
    <button
      onClick={() => navigate("/passkeys#security-alerts")}
      className="w-full mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-left text-xs text-yellow-400 hover:bg-yellow-500/15 transition-colors"
    >
      <ShieldAlert className="w-4 h-4 shrink-0" />
      <span className="flex-1">{t("alerts.banner", { n: unread })}</span>
      <span className="font-medium shrink-0">{t("alerts.review")}</span>
    </button>
  );
}
