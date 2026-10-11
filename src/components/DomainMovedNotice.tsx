import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronDown } from "lucide-react";
import { KEYGEN_CLOSED, MIGRATE_TO_HOST, MIGRATE_TO_URL } from "../lib/domain-migration";

/**
 * Shown on the legacy domain only. Explains the move to the new domain and the two ways
 * to bring funds across: a new wallet + transfer (recommended) or key-file import.
 */
/** `signedIn` adds in-app links (export key file, config) that only work after login. */
export function DomainMovedNotice({ className = "", signedIn = false }: { className?: string; signedIn?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!KEYGEN_CLOSED) return null;

  return (
    <div className={`bg-blue-500/10 border border-blue-500/20 rounded-lg px-4 py-3 text-left ${className}`}>
      <p className="text-xs text-blue-400 font-medium">{t("domainMove.title", { host: MIGRATE_TO_HOST })}</p>
      <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{t("domainMove.desc")}</p>

      <div className="flex items-center gap-3 mt-2.5">
        <a
          href={MIGRATE_TO_URL}
          className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
        >
          {t("domainMove.open", { host: MIGRATE_TO_HOST })}
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
        >
          {t("domainMove.howTo")}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2.5 text-[11px] leading-relaxed">
          <div>
            <p className="text-text-secondary font-medium">{t("domainMove.option1Title")}</p>
            <p className="text-text-muted mt-0.5">{t("domainMove.option1Desc", { host: MIGRATE_TO_HOST })}</p>
          </div>
          <div>
            <p className="text-text-secondary font-medium">{t("domainMove.option2Title")}</p>
            <p className="text-text-muted mt-0.5">{t("domainMove.option2Desc", { host: MIGRATE_TO_HOST })}</p>
            {signedIn && (
              <Link to="/backup-recovery" className="inline-block mt-1 text-blue-400 hover:underline">
                {t("domainMove.exportKeyFile")}
              </Link>
            )}
          </div>
          <p className="text-text-muted">
            {t("domainMove.configNote", { host: MIGRATE_TO_HOST })}
            {signedIn && (
              <>
                {" "}
                <Link to="/config" className="text-blue-400 hover:underline">{t("domainMove.openConfig")}</Link>
              </>
            )}
          </p>
          <p className="text-text-secondary font-medium">{t("domainMove.antiPhishing", { host: MIGRATE_TO_HOST })}</p>
        </div>
      )}
    </div>
  );
}
