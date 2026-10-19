// Which of these wallets is View only on this browser (its device key is pending or removed).
import { useEffect, useState } from "react";
import { getSignerRecord } from "./device-signer-key";
import { isRecoveryMode } from "./recovery";

export function useViewOnlyKeys(keyIds: string[]): string[] {
  const [viewOnly, setViewOnly] = useState<string[]>([]);
  const idsKey = keyIds.join(",");

  useEffect(() => {
    let live = true;
    // Recovery mode signs locally with both shares: no signer is involved, never View only.
    const ids = idsKey && !isRecoveryMode() ? idsKey.split(",") : [];
    const refresh = async () => {
      const recs = await Promise.all(ids.map((id) => getSignerRecord(id).catch(() => null)));
      if (live) setViewOnly(ids.filter((_, i) => recs[i] && recs[i]!.status !== "active" && recs[i]!.signerId));
    };
    void refresh();
    window.addEventListener("kx-signer-changed", refresh);
    return () => { live = false; window.removeEventListener("kx-signer-changed", refresh); };
  }, [idsKey]);

  return viewOnly;
}
