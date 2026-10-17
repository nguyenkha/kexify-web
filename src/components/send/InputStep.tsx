import { maskAmount } from "../../lib/hidden-amount";
import { formatUsd } from "../../lib/prices";
import { shortAddress } from "../../lib/review";
import { NetworkChip } from "../review/review-header";
import { truncateBalance } from "../sendTypes";
import type { InputStepProps } from "./types";
import { KeyShareUpload } from "../KeyShareUpload";
import { AddressSection } from "./AddressSection";
import { ExpertOverrides, ExpertFeeLevelSelector } from "./ExpertOverrides";

/** Fee quote failed: say so and offer a retry instead of "Estimating..." forever. */
function FeeFailed({ onRetry, t }: { onRetry: () => void; t: InputStepProps["t"] }) {
  return (
    <span className="text-[10px] text-red-400">
      {t("send.feeFailed")}{" "}
      <button type="button" onClick={onRetry} className="font-medium text-blue-400 hover:text-blue-300 underline">
        {t("common.retry")}
      </button>
    </span>
  );
}

export function InputStep({
  chain,
  asset,
  address,
  balance,
  expert,
  recovery,
  speedUpData,
  keyFile,
  setKeyFile,
  hasStoredShare,
  keyId,
  to,
  setTo,
  resolving,
  resolvedName,
  showAddrScanner,
  setShowAddrScanner,
  showSuggestions,
  setShowSuggestions,
  savingToBook,
  setSavingToBook,
  bookmarkLabel,
  setBookmarkLabel,
  toTouched: _toTouched,
  setToTouched,
  toValid,
  toSelf,
  toError,
  placeholder,
  destinationTag,
  setDestinationTag,
  xlmMemo,
  setXlmMemo,
  amount,
  setAmount,
  amountTouched: _amountTouched,
  setAmountTouched,
  amountCheck: _amountCheck,
  amountError,
  amountUsd,
  maxSendable,
  maxInputsCapped,
  balancesHidden,
  feeLevel,
  setFeeLevel,
  feeDisplay,
  feeCountdown,
  feeError,
  onRetryFee,
  btcFeeRates,
  ltcFeeRates,
  bchFeeRates,
  baseGasPrice,
  gasPrice,
  defaultGasLimit,
  nonceOverride,
  setNonceOverride,
  gasLimitOverride,
  setGasLimitOverride,
  maxFeeOverride,
  setMaxFeeOverride,
  priorityFeeOverride,
  setPriorityFeeOverride,
  btcFeeRateOverride,
  setBtcFeeRateOverride,
  rbfEnabled,
  setRbfEnabled,
  currentNonce,
  showUtxoPicker,
  setShowUtxoPicker,
  availableUtxos,
  selectedUtxoKeys,
  setSelectedUtxoKeys,
  utxoLoading,
  hasBackup,
  backupGateError,
  setBackupGateError,
  totalUsd: _totalUsd,
  canReview,
  policyChecking,
  onPreview,
  t,
  handleFetchUtxosCallback,
}: InputStepProps) {
  return (
    <>
      {/* Body — Input step */}
      <div className="px-5 pt-3 pb-5 space-y-4">
        {!recovery && !hasStoredShare && (
          <KeyShareUpload keyFile={keyFile} onChange={setKeyFile} expectedKeyId={keyId} showRestoreHint />
        )}

        {/* From: asset + chain + balance (same order as the iOS form), address short */}
        <div>
          <label className="block text-xs text-text-muted mb-1.5">{t("send.from")}</label>
          <div className="bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {asset.iconUrl || chain.iconUrl ? (
                <img src={asset.iconUrl || chain.iconUrl!} alt="" className="w-9 h-9 rounded-full bg-surface-tertiary object-cover shrink-0" />
              ) : (
                <span className="w-9 h-9 rounded-full bg-surface-tertiary shrink-0" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{asset.symbol}</p>
                <p className="text-xs text-text-muted truncate flex items-center gap-1.5">
                  <NetworkChip name={chain.displayName} iconUrl={chain.iconUrl} />
                  <span className="font-mono">{shortAddress(address)}</span>
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-text-muted">{t("send.balance")}</p>
              <p className="text-sm tabular-nums text-text-primary">{maskAmount(truncateBalance(balance), asset.symbol, balancesHidden)}</p>
            </div>
          </div>
        </div>

        {/* Speed-up banner */}
        {speedUpData && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
            <p className="text-xs text-yellow-400 font-medium">{t("send.rbfBanner")}</p>
            <p className="text-[11px] text-yellow-400/70 mt-0.5">{t("send.rbfDesc")}</p>
          </div>
        )}

        <AddressSection
          chain={chain}
          to={to}
          setTo={setTo}
          resolving={resolving}
          resolvedName={resolvedName}
          showAddrScanner={showAddrScanner}
          setShowAddrScanner={setShowAddrScanner}
          showSuggestions={showSuggestions}
          setShowSuggestions={setShowSuggestions}
          savingToBook={savingToBook}
          setSavingToBook={setSavingToBook}
          bookmarkLabel={bookmarkLabel}
          setBookmarkLabel={setBookmarkLabel}
          setToTouched={setToTouched}
          toValid={toValid}
          toSelf={toSelf}
          toError={toError}
          placeholder={placeholder}
          destinationTag={destinationTag}
          setDestinationTag={setDestinationTag}
          xlmMemo={xlmMemo}
          setXlmMemo={setXlmMemo}
          speedUpData={speedUpData}
          t={t}
        />

        {/* Amount: Max inside the field, fiat value under it */}
        <div>
          <label className="block text-xs text-text-muted mb-1.5">{t("send.amount")}</label>
          <div className={`flex items-center gap-2 bg-surface-primary border rounded-lg pl-3 pr-2 py-1.5 ${amountError ? "border-red-500/50 focus-within:border-red-500" : "border-border-primary focus-within:border-blue-500"}`}>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => { if (!speedUpData) setAmount(e.target.value); }}
              onBlur={() => setAmountTouched(true)}
              placeholder="0.00"
              readOnly={!!speedUpData}
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-text-primary placeholder:text-text-muted focus:outline-none tabular-nums"
            />
            <span className="text-sm text-text-muted shrink-0">{asset.symbol}</span>
            <button
              onClick={() => { if (maxSendable != null) { setAmount(maxSendable); setAmountTouched(true); } }}
              disabled={maxSendable == null}
              title={maxSendable == null ? t("common.estimating") : undefined}
              className="shrink-0 rounded-full border border-border-primary px-3 py-1 text-xs font-semibold text-blue-400 hover:bg-surface-tertiary disabled:text-text-muted disabled:cursor-not-allowed transition-colors"
            >
              {t("send.max")}
            </button>
          </div>
          <div className="mt-1.5 min-h-5">
            {amountError ? (
              <p className="text-xs text-red-400">{amountError}</p>
            ) : amountUsd != null ? (
              <p className="text-sm text-text-muted tabular-nums">&asymp; {formatUsd(amountUsd)}</p>
            ) : null}
            {maxInputsCapped != null && !amountError && (
              <p className="mt-1 text-xs text-amber-400">{t("send.maxInputsCapped", { max: maxInputsCapped })}</p>
            )}
          </div>
        </div>

        {/* Fee level selector */}
        {feeDisplay.hasLevelSelector && (
          expert ? (
            <ExpertFeeLevelSelector
              chain={chain}
              feeLevel={feeLevel}
              setFeeLevel={setFeeLevel}
              btcFeeRates={btcFeeRates}
              ltcFeeRates={ltcFeeRates}
              baseGasPrice={baseGasPrice}
              t={t}
            />
          ) : (
            <div className="flex items-center justify-between px-3 py-2 bg-surface-primary border border-border-primary rounded-lg">
              <span className="text-sm text-text-muted">{t("send.networkFee")}</span>
              <span className="text-xs tabular-nums text-text-secondary">
                {feeDisplay.usd != null && feeDisplay.usd > 0
                  ? formatUsd(feeDisplay.usd)
                  : feeDisplay.formatted != null
                    ? `${feeDisplay.formatted} ${feeDisplay.symbol}`
                    : feeError ? <FeeFailed onRetry={onRetryFee} t={t} /> : t("common.estimating")}
              </span>
            </div>
          )
        )}

        {/* Expert overrides */}
        {expert && (
          <ExpertOverrides
            chain={chain}
            asset={asset}
            feeLevel={feeLevel}
            nonceOverride={nonceOverride}
            setNonceOverride={setNonceOverride}
            gasLimitOverride={gasLimitOverride}
            setGasLimitOverride={setGasLimitOverride}
            maxFeeOverride={maxFeeOverride}
            setMaxFeeOverride={setMaxFeeOverride}
            priorityFeeOverride={priorityFeeOverride}
            setPriorityFeeOverride={setPriorityFeeOverride}
            currentNonce={currentNonce}
            defaultGasLimit={defaultGasLimit}
            gasPrice={gasPrice}
            baseGasPrice={baseGasPrice}
            btcFeeRates={btcFeeRates}
            ltcFeeRates={ltcFeeRates}
            bchFeeRates={bchFeeRates}
            btcFeeRateOverride={btcFeeRateOverride}
            setBtcFeeRateOverride={setBtcFeeRateOverride}
            rbfEnabled={rbfEnabled}
            setRbfEnabled={setRbfEnabled}
            showUtxoPicker={showUtxoPicker}
            setShowUtxoPicker={setShowUtxoPicker}
            availableUtxos={availableUtxos}
            selectedUtxoKeys={selectedUtxoKeys}
            setSelectedUtxoKeys={setSelectedUtxoKeys}
            utxoLoading={utxoLoading}
            handleFetchUtxosCallback={handleFetchUtxosCallback}
            t={t}
          />
        )}

        {/* Fee summary (expert; the simple view already shows one Network fee row) */}
        {(expert || !feeDisplay.hasLevelSelector) && <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-text-muted flex items-center gap-1">
            {t("send.estFee")}
            {!feeDisplay.isFixed && (
              <span className="text-text-muted/40 tabular-nums">
                {feeCountdown > 0 ? `\u00b7 ${feeCountdown}s` : "\u00b7 \u27f3"}
              </span>
            )}
          </span>
          {feeDisplay.formatted != null ? (
            <span className="text-[11px] tabular-nums text-text-secondary">
              {feeDisplay.formatted} {feeDisplay.symbol}
              {feeDisplay.usd != null && feeDisplay.usd > 0 && (
                <span className="text-text-muted ml-1">({formatUsd(feeDisplay.usd)})</span>
              )}
            </span>
          ) : feeError ? (
            <FeeFailed onRetry={onRetryFee} t={t} />
          ) : (
            <span className="text-[10px] text-text-muted animate-pulse">{t("common.estimating")}</span>
          )}
        </div>}
      </div>

      {/* Footer — Input step */}
      <div className="px-5 py-4 border-t border-border-secondary shrink-0">
        {backupGateError && (
          <p className="text-[11px] text-yellow-400 mb-2">{backupGateError}</p>
        )}
        <button
          disabled={!canReview || policyChecking}
          onClick={async () => {
            if (hasBackup === false && (amountUsd ?? 0) > 100) {
              setBackupGateError(t("send.backupRequired"));
              return;
            }
            setBackupGateError(null);
            await onPreview();
          }}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          {policyChecking ? t("wc.checking") : t("send.previewButton")}
        </button>
      </div>
    </>
  );
}
