import { useTranslation } from "react-i18next";
import type { DecodedSolanaTx } from "../lib/chains/solanaTx";
import type { DecodedSolanaIx } from "../lib/chains/solanaIx";
import { formatLamports } from "../lib/chains/solanaIx";

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);

function Addr({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <span className="font-mono text-text-secondary break-all text-right" title={value}>{short(value)}</span>
    </div>
  );
}

function IxBody({ ix }: { ix: DecodedSolanaIx }) {
  const { t } = useTranslation();
  const amt = (symbol: string) => `${ix.formattedAmount ?? ix.amount} ${symbol}`;
  switch (ix.type) {
    case "sol_transfer":
      return <><div className="text-text-primary">{t("wc.sol.sendSol", { amount: amt("SOL") })}</div>{ix.to && <Addr label={t("wc.sol.to")} value={ix.to} />}</>;
    case "spl_transfer":
      return (
        <>
          <div className="text-text-primary">{t("wc.sol.sendToken", { amount: ix.formattedAmount ?? ix.amount })}</div>
          {ix.account && <Addr label={t("wc.sol.account")} value={ix.account} />}
          {ix.mint && <Addr label={t("wc.sol.mint")} value={ix.mint} />}
          {ix.to && <Addr label={t("wc.sol.toAccount")} value={ix.to} />}
          {ix.destOwner && <Addr label={t("wc.sol.toOwner")} value={ix.destOwner} />}
        </>
      );
    case "spl_approve":
      return (
        <>
          <div className="text-text-primary">{t("wc.sol.approve", { amount: ix.formattedAmount ?? ix.amount })}</div>
          {ix.account && <Addr label={t("wc.sol.account")} value={ix.account} />}
          {ix.delegate && <Addr label={t("wc.sol.delegate")} value={ix.delegate} />}
          {ix.mint && <Addr label={t("wc.sol.mint")} value={ix.mint} />}
        </>
      );
    case "spl_set_authority":
      return (
        <>
          <div className="text-text-primary">{t("wc.sol.setAuthority")}</div>
          {ix.account && <Addr label={t("wc.sol.account")} value={ix.account} />}
          <Addr label={t("wc.sol.newAuthority")} value={ix.newAuthority ?? t("wc.sol.none")} />
        </>
      );
    case "spl_close_account":
      return <><div className="text-text-primary">{t("wc.sol.closeAccount")}</div>{ix.to && <Addr label={t("wc.sol.rentTo")} value={ix.to} />}</>;
    case "ata_create":
      return <><div className="text-text-primary">{t("wc.sol.createAta")}</div>{ix.destOwner && <Addr label={t("wc.sol.toOwner")} value={ix.destOwner} />}{ix.mint && <Addr label={t("wc.sol.mint")} value={ix.mint} />}</>;
    case "compute_budget":
      return <div className="text-text-primary">{ix.op === "setComputeUnitPrice" ? t("wc.sol.cuPrice", { price: ix.computeUnitPrice }) : ix.op === "setComputeUnitLimit" ? t("wc.sol.cuLimit", { limit: ix.computeUnitLimit }) : t("wc.sol.computeBudget")}</div>;
    case "memo":
      return <div className="text-text-primary break-all">{t("wc.sol.memo", { text: ix.memo })}</div>;
    case "account_control":
      return <><div className="text-text-primary">{t("wc.sol.accountControl", { op: ix.op })}</div>{ix.account && <Addr label={t("wc.sol.account")} value={ix.account} />}</>;
    case "spl_other":
      return <div className="text-text-primary">{t("wc.sol.tokenOp", { op: ix.op })}</div>;
    case "program":
      if (ix.op) return <div className="text-text-primary">{ix.programLabel ?? ix.programId}: {ix.op}</div>;
      return <div className="text-text-primary">{ix.programLabel ? t("wc.sol.callProgram", { name: ix.programLabel }) : t("wc.sol.unknownProgram", { id: ix.programId })}</div>;
    default:
      return <div className="text-text-primary">{ix.detail ?? t("wc.sol.undecoded")}</div>;
  }
}

/** Every instruction of a Solana transaction, in order, with a warning when any of them is high risk. */
export function SolanaInstructionList({ decoded }: { decoded: DecodedSolanaTx }) {
  const { t } = useTranslation();
  const risky = decoded.instructions.some((i) => i.highRisk);
  return (
    <div className="space-y-2" data-testid="solana-instructions">
      <div className="text-xs text-text-muted">{t("wc.sol.instructions", { count: decoded.instructions.length })}</div>
      {risky && (
        <p className="text-[11px] text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">{t("wc.sol.riskWarning")}</p>
      )}
      <ol className="space-y-2">
        {decoded.instructions.map((ix, i) => (
          <li key={i} className={`rounded-lg border px-3 py-2 text-xs space-y-1 ${ix.highRisk ? "border-amber-500/40" : "border-border-primary"} bg-surface-primary`}>
            <IxBody ix={ix} />
          </li>
        ))}
      </ol>
      {decoded.fee.exceedsCap && (
        <p className="text-[11px] text-red-400">{t("wc.sol.feeCap", { cap: formatLamports(BigInt(decoded.fee.capLamports)) })}</p>
      )}
    </div>
  );
}
