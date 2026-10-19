// The signing device watches its wallets for devices waiting to take over signing (phase 3). Checks on open,
// when the tab comes back, and every 60 s while visible. A dismissed move (cooling) is asked again the next time
// the app is opened or the tab comes back; a plain new device (not cooling) is asked once per device, then the
// alerts banner is the reminder.
import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "./apiBase";
import { authHeaders, getToken } from "./auth";
import { getSignerRecord } from "./device-signer-key";
import { isRecoveryMode } from "./recovery";
import { listSigners, type SignerRow } from "./signer-api";

export interface PendingSignerRequest { keyShareId: string; walletName: string | null; signer: SignerRow }

const POLL_MS = 60_000;
const SEEN_PREFIX = "kx-signer-prompted:";

function seen(id: string): boolean {
  try { return localStorage.getItem(SEEN_PREFIX + id) === "1"; } catch { return false; }
}
function markSeen(id: string): void {
  try { localStorage.setItem(SEEN_PREFIX + id, "1"); } catch { /* storage blocked: asked again next time */ }
}

/** Pending rows of other devices on wallets where this device is the active signer (cooling ones first). */
export async function findPendingSignerRequests(): Promise<PendingSignerRequest[]> {
  if (isRecoveryMode() || !getToken()) return [];
  const res = await fetch(apiUrl("/api/keys"), { headers: authHeaders() });
  if (!res.ok) return [];
  const keys = ((await res.json()).keys ?? []) as Array<{ id: string; name: string | null; enabled?: boolean }>;
  const found = await Promise.all(keys.filter((k) => k.enabled !== false).map(async (k) => {
    const rec = await getSignerRecord(k.id).catch(() => null);
    if (!rec?.signerId || rec.status !== "active") return [];
    const rows = await listSigners(k.id).catch(() => [] as SignerRow[]);
    // listSigners refreshed the local state: a device that stopped signing has nothing to answer.
    if ((await getSignerRecord(k.id).catch(() => null))?.status !== "active") return [];
    return rows.filter((s) => s.status === "pending" && s.id !== rec.signerId)
      .map((signer) => ({ keyShareId: k.id, walletName: k.name, signer }));
  }));
  return found.flat().sort((a, b) => Number(!!b.signer.cooling) - Number(!!a.signer.cooling));
}

export function usePendingSignerRequests() {
  const [requests, setRequests] = useState<PendingSignerRequest[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    try { setRequests(await findPendingSignerRequests()); } catch { /* offline: ask on the next check */ }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0); // first check right after mount
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setDismissed(new Set()); // back in front = opened again: ask again
      void refresh();
    };
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const current = requests.find((r) => !dismissed.has(r.signer.id) && (r.signer.cooling || !seen(r.signer.id))) ?? null;
  /** Hide this request until the app is opened again; `forever` (plain new device only) never prompts it again. */
  const dismiss = useCallback((r: PendingSignerRequest, forever = false) => {
    if (forever && !r.signer.cooling) markSeen(r.signer.id);
    setDismissed((d) => new Set(d).add(r.signer.id));
  }, []);
  return { current, dismiss, refresh };
}
