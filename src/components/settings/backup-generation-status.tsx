// Settings > Security, per wallet from GET /keys/:id/backup/status: after a device move older backups and kits
// stop working ("Download a new kit"); a signing device that went on without a new backup shows the amber
// "Not backed up" line; otherwise how many passkeys can restore the wallet.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../../lib/apiBase";
import { authHeaders } from "../../lib/auth";
import { getSignerRecord } from "../../lib/device-signer-key";
import { fetchBackupStatus } from "../../lib/escrow-download";

type Row = { id: string; name: string | null; kind: "old" | "none" | "count"; n?: number };

export function BackupGenerationStatus() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch(apiUrl("/api/keys"), { headers: authHeaders() }).catch(() => null);
      if (!res?.ok) return;
      const keys = ((await res.json()).keys ?? []) as Array<{ id: string; name: string | null; enabled?: boolean }>;
      const out = await Promise.all(keys.filter((k) => k.enabled !== false).map(async (k): Promise<Row | null> => {
        const s = await fetchBackupStatus(k.id).catch(() => null);
        if (!s) return null;
        if (s.hasBackup && !s.current) return { id: k.id, name: k.name, kind: "old" };
        const signing = (await getSignerRecord(k.id).catch(() => null))?.status === "active";
        if (signing && !s.hasBackup && !s.passkeys && !s.password) return { id: k.id, name: k.name, kind: "none" };
        const n = (s.recipients ?? []).filter((r) => r.approved).length;
        return n > 0 ? { id: k.id, name: k.name, kind: "count", n } : null;
      }));
      if (live) setRows(out.filter((r): r is Row => !!r));
    })();
    return () => { live = false; };
  }, []);

  if (rows.length === 0) return null;
  return (
    <div className="space-y-2 pt-4">
      {rows.map((k) => k.kind === "count" ? (
        <p key={k.id} className="text-xs text-text-muted px-1">
          {rows.length > 1 && k.name ? `${k.name}: ` : ""}{t("backup.passkeys.count", { n: k.n })}
        </p>
      ) : (
        <div key={k.id} className="flex items-center gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2">
          <span className="flex-1 text-xs text-text-secondary">
            {rows.length > 1 && k.name ? `${k.name}: ` : ""}{t(k.kind === "old" ? "backup.old" : "backup.notBackedUp")}
          </span>
          <button onClick={() => navigate("/backup-recovery")} className="text-[11px] px-2 py-1 rounded bg-surface-tertiary text-text-secondary hover:bg-border-primary shrink-0">
            {t(k.kind === "old" ? "backup.newKit" : "backup.setPassword")}
          </button>
        </div>
      ))}
    </div>
  );
}
