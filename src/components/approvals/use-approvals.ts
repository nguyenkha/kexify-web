import { useCallback, useEffect, useRef, useState } from "react";
import type { Chain } from "../../lib/api";
import { fetchApprovals } from "../../lib/approvals/fetch-approvals";
import { contractInfos, type ContractInfo } from "../../lib/approvals/approval-labels";
import { approvalKey, type ApprovalsResult } from "../../lib/approvals/types";

const REFETCH_AFTER_REVOKE_MS = 15_000;

/** Approvals of one account with names; `markRevoking` flags a row and re-reads the chain once after ~15 s. */
export function useApprovals(chain: Chain, address: string) {
  const [result, setResult] = useState<ApprovalsResult | null>(null);
  const [infos, setInfos] = useState<Map<string, ContractInfo>>(new Map());
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<Set<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alive = useRef(true);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) { setLoading(true); setFailed(false); }
    try {
      const res = await fetchApprovals(chain, address);
      const names = await contractInfos(chain, res.approvals);
      if (!alive.current) return;
      setResult(res);
      setInfos(names);
      // A row whose live state is zero is gone from `res`; one that is still there is no longer "Revoking…".
      setRevoking(new Set());
    } catch {
      if (alive.current && !silent) setFailed(true);
    } finally {
      if (alive.current && !silent) setLoading(false);
    }
  }, [chain, address]);

  useEffect(() => {
    alive.current = true;
    void load(false);
    return () => { alive.current = false; timers.current.forEach(clearTimeout); timers.current = []; };
  }, [load]);

  const markRevoking = useCallback((key: string) => {
    setRevoking((prev) => new Set(prev).add(key));
    timers.current.push(setTimeout(() => void load(true), REFETCH_AFTER_REVOKE_MS));
  }, [load]);

  return { result, infos, failed, loading, revoking, retry: () => load(false), markRevoking, keyOf: approvalKey };
}
