import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Spinner, EmptyState, ErrorBox } from "../ui";
import { useFrozen } from "../../context/FrozenContext";
import { approvalKey, type Approval } from "../../lib/approvals/types";
import { ApprovalRow } from "./ApprovalRow";
import { RevokeRequest } from "./RevokeRequest";
import { useApprovals } from "./use-approvals";
import { useApprovalsAccount, type ApprovalsAccount } from "./use-approvals-account";

/** Route /accounts/:keyId/:chainName/approvals: who may move this account's tokens, with a one-tap revoke. */
export function ApprovalsPage() {
  const { keyId, chainName } = useParams<{ keyId: string; chainName: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { account, loading } = useApprovalsAccount(keyId, chainName);

  const back = (
    <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors">
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      {t("common.back")}
    </button>
  );

  if (loading) return <div className="flex items-center justify-center py-24"><Spinner /></div>;
  if (!account) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState title={t("account.notFound")} />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {back}
      <div>
        <h1 className="text-lg font-semibold text-text-primary">{t("approvals.title")}</h1>
        <p className="text-xs text-text-muted mt-1">{t("approvals.subtitle", { chain: account.chain.displayName })}</p>
      </div>
      <ApprovalsList account={account} />
    </div>
  );
}

function ApprovalsList({ account }: { account: ApprovalsAccount }) {
  const { t } = useTranslation();
  const frozen = useFrozen();
  const { chain, address } = account;
  const { result, infos, failed, loading, revoking, retry, markRevoking } = useApprovals(chain, address);
  const [target, setTarget] = useState<Approval | null>(null);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (failed || !result) {
    return (
      <div className="space-y-3">
        <ErrorBox>{t("approvals.loadFailed")}</ErrorBox>
        <button onClick={retry} className="text-xs text-blue-400 hover:text-blue-300">{t("common.retry")}</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {result.partial && <p className="text-[11px] text-text-muted">{t("approvals.partial")}</p>}
      {result.truncated && <p className="text-[11px] text-text-muted">{t("approvals.truncated")}</p>}
      {result.approvals.length === 0 ? (
        <EmptyState title={t("approvals.empty")} description={t("approvals.emptyHint")} />
      ) : (
        <ul className="space-y-2.5">
          {result.approvals.map((a) => (
            <ApprovalRow
              key={approvalKey(a)}
              approval={a}
              info={infos.get(a.contract.toLowerCase())}
              revoking={revoking.has(approvalKey(a))}
              disabled={frozen}
              onRevoke={() => setTarget(a)}
            />
          ))}
        </ul>
      )}
      {frozen && <p className="text-[11px] text-text-muted">{t("freeze.blockedReason")}</p>}
      {target && (
        <RevokeRequest
          key={approvalKey(target)}
          chain={chain}
          owner={address}
          approval={target}
          info={infos.get(target.contract.toLowerCase())}
          onSent={() => markRevoking(approvalKey(target))}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
