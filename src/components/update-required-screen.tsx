import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { subscribeUpdateRequired, type UpdateRequired } from "../lib/client-version-gate";

const AUTO_RELOAD_MS = 2500;
/** Auto-reload at most once a minute: if the CDN still serves the old build, stop and let the user retry. */
const RELOAD_GUARD_KEY = "kx.updateReloadAt";
const RELOAD_GUARD_MS = 60_000;

function mayAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

/** Blocking "new version available" screen, shown when the API refuses this build (426) or a chunk is gone. */
export function UpdateRequiredScreen() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateRequired | null>(null);

  useEffect(() => subscribeUpdateRequired(setInfo), []);

  useEffect(() => {
    if (!info?.autoReload || !mayAutoReload()) return;
    const id = setTimeout(() => window.location.reload(), AUTO_RELOAD_MS);
    return () => clearTimeout(id);
  }, [info]);

  if (!info) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-xl"
      role="alertdialog"
      aria-modal="true"
      aria-label={t("updateRequired.title")}
    >
      <div className="flex flex-col items-center gap-4 max-w-sm px-6 text-center">
        <svg className="w-12 h-12 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
        <h2 className="text-lg font-semibold text-white">{t("updateRequired.title")}</h2>
        <p className="text-sm text-text-muted">{t("updateRequired.description")}</p>
        <button
          onClick={() => window.location.reload()}
          className="w-full mt-2 px-4 py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 transition-colors"
        >
          {t("updateRequired.reload")}
        </button>
      </div>
    </div>
  );
}
