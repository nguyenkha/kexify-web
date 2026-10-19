// Route /move/restore: "I don't have it" before this browser knows the wallet. Pick it, then screen 3b.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiUrl } from "../../lib/apiBase";
import { authHeaders } from "../../lib/auth";

export function MoveRestorePick() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<Array<{ id: string; name: string | null }> | null>(null);
  useEffect(() => {
    fetch(apiUrl("/api/keys"), { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { keys: [] }))
      .then((d) => setKeys((d.keys ?? []).filter((k: { enabled?: boolean }) => k.enabled !== false)))
      .catch(() => setKeys([]));
  }, []);
  return (
    <div className="max-w-sm mx-auto mt-10 p-5 rounded-2xl border border-border-primary bg-surface-secondary space-y-3 text-center">
      <h1 className="text-base font-semibold text-text-primary">{t("restore.title")}</h1>
      {keys?.map((k) => (
        <Link key={k.id} to={`/move/restore/${k.id}`} className="block text-sm px-3 py-2 rounded-lg border border-border-primary text-text-primary">
          {k.name || k.id.slice(0, 8)}
        </Link>
      ))}
      <div className="text-xs text-text-muted"><Link to="/recovery" className="underline">{t("move.useFile")}</Link></div>
    </div>
  );
}
