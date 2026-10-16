import { ExpertWarnings, SimulationPreview } from "../tx";
import { BalancePreview, type BalanceChange } from "../BalancePreview";
import { ReviewBody, useScrollGate } from "../review";
import { buildSendReview } from "../../lib/review";
import { addressLabel } from "../../lib/address-label";
import { bytesToHex } from "../../shared/utils";
import { encodeErc20Transfer, parseUnits } from "../../lib/chains/evmTx";
import { SOLANA_BASE_FEE } from "../../lib/chains/solanaTx";
import { XRP_BASE_FEE } from "../../lib/chains/xrpTx";
import { EVM_FEE_MULTIPLIER } from "../sendTypes";
import type { PreviewStepProps } from "./types";
import { Lock } from "lucide-react";

/** Decimals of each chain's native asset (the fee asset). */
const NATIVE_DECIMALS: Record<string, number> = { evm: 18, solana: 9, btc: 8, ltc: 8, bch: 8, xrp: 6, xlm: 7, tron: 6, ton: 9, algo: 6, ada: 6 };

export function PreviewStep({
  chain,
  asset,
  address,
  to,
  amount,
  expert,
  feeDisplay,
  gasLimit,
  gasLimitOverride,
  maxFeeOverride,
  estimatedGas,
  baseGasPrice,
  gasEstimateError,
  estimatedFeeWei,
  xlmDestExists,
  destinationTag,
  xlmMemo,
  policyCheck,
  simResult,
  manualUtxos,
  rbfEnabled,
  currentNonce: _currentNonce,
  totalUsd: _totalUsd,
  amountUsd,
  balancesHidden: _balancesHidden,
  btcEstimatedFee,
  ltcEstimatedFee,
  bchEstimatedFee,
  prices,
  balance,
  setStep: _setStep,
  guardedSign,
  signingFlows,
  setSigningError,
  confirmBeforeBroadcast,
  firstTimeRecipient,
  onReviewPolicy,
  t,
}: PreviewStepProps) {
  const model = buildSendReview({
    asset,
    amount,
    to,
    from: { address },
    fee: feeDisplay.formatted != null
      ? { amount: feeDisplay.formatted, symbol: feeDisplay.symbol, decimals: NATIVE_DECIMALS[chain.type] ?? asset.decimals, usd: feeDisplay.usd }
      : null,
    amountUsd,
    prices,
    nameOf: (a) => addressLabel(a) ?? undefined,
    policy: policyCheck,
    firstTimeRecipient: firstTimeRecipient === true,
    gasEstimateFailed: chain.type === "evm" && !!gasEstimateError,
    memo: destinationTag ? { labelKey: "send.destinationTag", value: destinationTag } : chain.type === "xlm" && xlmMemo ? { labelKey: "send.memo", value: xlmMemo } : null,
  });
  const gate = useScrollGate(`${chain.id}:${to}:${amount}`);
  const blocked = policyCheck?.allowed === false;
  return (
    <>
      {/* Body — Preview step */}
      <div className="p-5 space-y-5">
        <ReviewBody model={model} copyable={false} expert={expert} onReviewPolicy={onReviewPolicy} onSeenEnd={gate.onSeenEnd}>
        {chain.type === "xlm" && xlmDestExists === false && (
          <p className="text-[10px] text-yellow-400">{t("send.xlmDestNotActive")}</p>
        )}

        {chain.type === "evm" && gasEstimateError && gasEstimateError !== "gas_estimate_failed" && (
          <details className="px-1">
            <summary className="text-[10px] text-text-muted cursor-pointer">{t("common.details")}</summary>
            <p className="text-[10px] font-mono text-text-muted break-all mt-1">{gasEstimateError}</p>
          </details>
        )}
        {expert && (
          <div className="bg-surface-primary border border-border-primary rounded-xl overflow-hidden empty:hidden [&>div:first-child]:border-t-0">
          {expert && !asset.isNative && asset.contractAddress && (
            <div className="border-t border-border-secondary px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{t("send.data")}</span>
              </div>
              <pre className="text-[10px] font-mono text-text-muted break-all mt-1 leading-relaxed max-h-20 overflow-auto">
                {"0x" + bytesToHex(encodeErc20Transfer(to, parseUnits(amount, asset.decimals)) as Uint8Array)}
              </pre>
            </div>
          )}
          {expert && feeDisplay.rateLabel != null && (
            <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {chain.type === "btc" || chain.type === "ltc" || chain.type === "bch"
                  ? t("send.feeRate")
                  : chain.type === "xlm"
                    ? t("send.baseFee")
                    : t("send.maxFee")}
              </span>
              <span className="text-xs tabular-nums text-text-muted">{feeDisplay.rateLabel}</span>
            </div>
          )}
          {expert && chain.type === "evm" && (
            <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs text-text-muted">{t("send.gasLimit")}</span>
              <span className="text-xs tabular-nums text-text-muted">{gasLimit.toLocaleString()}</span>
            </div>
          )}
          {expert && manualUtxos && (chain.type === "btc" || chain.type === "ltc" || chain.type === "bch") && (
            <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs text-text-muted">{t("send.utxos")}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-blue-500/10 text-blue-400">
                {t("send.utxosSelected", { count: manualUtxos.length })}
              </span>
            </div>
          )}
          {expert && (chain.type === "btc" || chain.type === "ltc") && (
            <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs text-text-muted">{t("send.rbf")}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${rbfEnabled ? "bg-blue-500/10 text-blue-400" : "bg-surface-tertiary text-text-muted"}`}>
                {rbfEnabled ? t("xlm.enabled") : t("wallet.disabled")}
              </span>
            </div>
          )}
          </div>
        )}
        {/* Expert warnings */}
        {expert && chain.type === "evm" && (
          <ExpertWarnings
            gasLimitOverride={gasLimitOverride}
            maxFeeOverride={maxFeeOverride}
            estimatedGas={estimatedGas}
            baseGasPrice={baseGasPrice}
            lowMultiplier={EVM_FEE_MULTIPLIER.low}
          />
        )}

        {/* Balance changes — simulation or static fallback */}
        {simResult && simResult.changes.length > 0 ? (
          <SimulationPreview simResult={simResult} prices={prices} />
        ) : (() => {
          const changes: BalanceChange[] = [];
          const amountBase = amount ? parseUnits(amount, asset.decimals) : 0n;
          const balanceBase = parseUnits(balance, asset.decimals);

          if (asset.isNative) {
            let feeCost = 0n;
            if (chain.type === "evm" && estimatedFeeWei != null) feeCost = estimatedFeeWei;
            else if (chain.type === "solana") feeCost = SOLANA_BASE_FEE;
            else if (chain.type === "xrp") feeCost = XRP_BASE_FEE;
            else if (chain.type === "btc" && btcEstimatedFee != null) feeCost = btcEstimatedFee;
            else if (chain.type === "ltc" && ltcEstimatedFee != null) feeCost = ltcEstimatedFee;
            else if (chain.type === "bch" && bchEstimatedFee != null) feeCost = bchEstimatedFee;
            changes.push({
              symbol: asset.symbol,
              decimals: asset.decimals,
              currentBalance: balanceBase.toString(),
              delta: -(amountBase + feeCost),
            });
          } else {
            changes.push({
              symbol: asset.symbol,
              decimals: asset.decimals,
              currentBalance: balanceBase.toString(),
              delta: -amountBase,
            });
          }

          return <BalancePreview changes={changes} prices={prices} />;
        })()}
        </ReviewBody>
      </div>

      {/* Footer — Preview step */}
      <div className="px-5 py-4 border-t border-border-secondary shrink-0 sticky bottom-0 bg-surface-secondary pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
        <button
          disabled={blocked || !gate.seen}
          onClick={() => {
            const { executeEvm, executeBtc, executeLtc, executeBch, executeSolana, executeXrp, executeXlm, executeTron, executeTon, executeAlgo, executeAda } = signingFlows;
            const flows: Record<string, () => void> = {
              solana: executeSolana,
              btc: executeBtc,
              ltc: executeLtc,
              bch: executeBch,
              evm: executeEvm,
              xrp: executeXrp,
              xlm: executeXlm,
              tron: executeTron,
              ton: executeTon,
              algo: executeAlgo,
              ada: executeAda,
            };
            const flow = flows[chain.type];
            if (flow) guardedSign(flow);
            else setSigningError({ kind: "error", message: t("send.unsupportedChain", { chain: chain.displayName }), detail: chain.type });
          }}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          {blocked ? <><Lock className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("send.blockedByPolicy")}</> : !gate.seen ? t("review.scrollToReview") : <><Lock className="w-4 h-4 inline-block align-[-2px] mr-1" />{t(confirmBeforeBroadcast ? "send.confirmSign" : "send.confirmSend")}</>}
        </button>
      </div>
    </>
  );
}
