import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { friendlyError } from "./send/signing-flows";
import { notify } from "../lib/notify";
import { Button } from "./ui";
import { Eye, Lock } from "lucide-react";
import type { Chain, Asset } from "../lib/api";
import { explorerLink } from "../shared/utils";
import { useSteppedProgress, signingDurationMs, ProgressBar } from "./ProgressBar";
import { SigningError, SigningStepper, signRowLabel, txSigningSteps, TX_PHASE_STEP } from "./tx";
import { useExpertMode } from "../context/ExpertModeContext";
import { formatUsd, getUsdValue } from "../lib/prices";
import { toBase64, performMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../lib/mpc";
import { authHeaders } from "../lib/auth";
import { useToast } from "../context/ToastContext";
import { apiUrl } from "../lib/apiBase";
import { sensitiveHeaders } from "../lib/passkey";
import { usePasskeyPresence } from "./use-passkey-presence";
import { PasskeyGate } from "./PasskeyGate";
import { isRecoveryMode } from "../lib/recovery";
import { hasSigningShare, resolveSigningKeyFile } from "../lib/signing-key-file";
import { KeyPassphraseCancelled, cancelKeyPassphrase } from "../lib/key-passphrase-prompt";
import { KeyShareUpload } from "./KeyShareUpload";
import {
  strKeyToPublicKey,
  eddsaPubKeyToXlmAddress,
  buildXlmChangeTrustXdr,
  xlmHashForSigning,
  assembleXlmSignedTx,
  getXlmAccountInfo,
  broadcastXlmTransaction,
  waitForXlmConfirmation,
} from "../lib/chains/xlmTx";
import type { KeyFile, SigningPhase, TxResult } from "./sendTypes";

export function XlmTrustlineDialog({
  keyId, address, balance, chain, chainAssets, prices, onClose,
}: {
  keyId: string; address: string; balance: string; chain: Chain; chainAssets: Asset[]; prices: Record<string, number>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [step, setStep] = useState<"select" | "input" | "preview" | "signing" | "result">("select");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  // An uploaded key file, asked for only when this device holds no share for the account.
  const [keyFile, setKeyFile] = useState<KeyFile | null>(null);
  const [hasStoredShare] = useState(() => hasSigningShare(keyId));
  const [signingPhase, setSigningPhase] = useState<SigningPhase>("building-tx");
  const [signingError, setSigningError] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<TxResult | null>(null);
  const [pendingTxHash, setPendingTxHash] = useState<string | null>(null);
  const [passkeyGuard, setPasskeyGuard] = useState<"idle" | "gate">("idle");
  const { hasPasskey, markRegistered } = usePasskeyPresence();
  const pendingSignRef = useRef<(() => void) | null>(null);
  const [xlmFeeRate, setXlmFeeRate] = useState(100);
  const [enabledAssets, setEnabledAssets] = useState<Set<string>>(new Set());
  const recovery = isRecoveryMode();
  const expert = useExpertMode();
  const signLabel = signRowLabel(t, recovery);

  const phaseIndex = TX_PHASE_STEP;

  // Stepped progress: 90% for MPC signing, 10% split across broadcast + confirm
  const progress = useSteppedProgress(
    step === "signing" ? phaseIndex[signingPhase] : -1,
    1, // main step = MPC signing (index 1)
    2, // steps after main: broadcast + confirming
    signingDurationMs(1), // XLM = 1 EdDSA signature
    false,
  );
  const signLabelActive = progress.phase === "main"
    ? `${signLabel} ${progress.pct}%`
    : signLabel;

  useEffect(() => {
    if (isRecoveryMode()) return;
    if (chain.rpcUrl) {
      fetch(`${chain.rpcUrl}/fee_stats`).then(r => r.json()).then(data => {
        const p50 = parseInt(data.fee_charged?.p50 ?? "100", 10);
        setXlmFeeRate(p50);
      }).catch(() => {});
    }
  }, [keyId, chain.rpcUrl]);

  // Owner of this flow's passphrase prompt: unmounting cancels it (and only it).
  const [passphraseOwner] = useState(() => ({}));
  useEffect(() => () => cancelKeyPassphrase(passphraseOwner), [passphraseOwner]);

  // Clear deserialized key handles from memory when dialog closes or keyFile changes
  useEffect(() => {
    return () => { if (keyFile) clearClientKey(keyFile.id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyFile?.id]);

  // Fetch existing trustlines so we can indicate which tokens are already enabled
  useEffect(() => {
    if (!chain.rpcUrl || !address) return;
    fetch(`${chain.rpcUrl}/accounts/${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.balances) return;
        const codes = new Set<string>(
          (data.balances as { asset_type: string; asset_code?: string; asset_issuer?: string }[])
            .filter(b => b.asset_code)
            .map(b => `${b.asset_code}:${b.asset_issuer}`)
        );
        setEnabledAssets(codes);
      })
      .catch(() => {});
  }, [chain.rpcUrl, address]);

  async function guardedSign(action: (kf: KeyFile) => void) {
    // The account's share signs (a passphrase share asks for its passphrase here; a PRF
    // share is unlocked by the signing passkey), else the uploaded file.
    let kf: KeyFile | null;
    try {
      kf = await resolveSigningKeyFile(keyId, { needsEddsa: true, uploaded: hasStoredShare ? null : keyFile, owner: passphraseOwner });
    } catch (err: unknown) {
      if (err instanceof KeyPassphraseCancelled) return;
      setStep("signing");
      setSigningError(friendlyError(err, t));
      return;
    }
    if (!kf) return;
    const run = () => action(kf);
    if (isRecoveryMode()) { run(); return; }
    // The signing step asks for the passkey, bound to this transaction; only a missing one stops here.
    if (await hasPasskey()) run();
    else { pendingSignRef.current = run; setPasskeyGuard("gate"); }
  }

  function onPasskeyComplete() {
    markRegistered();
    setPasskeyGuard("idle");
    pendingSignRef.current?.();
    pendingSignRef.current = null;
  }

  async function executeTrustlineFlow(keyFile: KeyFile) {
    if (!keyFile || !chain.rpcUrl || !selectedAsset?.contractAddress) return;
    setStep("signing");
    setSigningPhase("building-tx");
    setSigningError(null);
    try {
      if (!clientKeys.has(keyFile.id)) {
        await restoreKeyHandles(keyFile.id, keyFile.share, keyFile.eddsaShare);
      }
      const fromAddress = eddsaPubKeyToXlmAddress(keyFile.eddsaPublicKey);
      const fromPubKey = strKeyToPublicKey(fromAddress);
      const { sequence } = await getXlmAccountInfo(chain.rpcUrl, fromAddress);
      const isTestnet = chain.rpcUrl.includes("testnet");
      const txXdr = buildXlmChangeTrustXdr({
        from: fromAddress,
        feeStroops: xlmFeeRate,
        sequence: sequence + 1n,
        asset: { code: selectedAsset.symbol, issuer: selectedAsset.contractAddress },
      });
      setSigningPhase("mpc-signing");
      const signingHash = await xlmHashForSigning(txXdr, isTestnet);
      const { signature: sigRaw, sessionId } = await performMpcSign({
        algorithm: "eddsa",
        keyId: keyFile.id,
        hash: signingHash,
        initPayload: {
          id: keyFile.id,
          algorithm: "eddsa",
          from: fromAddress,
          chainType: "xlm",
          unsignedTx: toBase64(txXdr),
          eddsaPublicKey: keyFile.eddsaPublicKey,
          xlmTx: { type: "change_trust", asset: selectedAsset.symbol },
        },
        headers: sensitiveHeaders(),
      });
      const txBase64 = assembleXlmSignedTx(txXdr, fromPubKey, sigRaw);
      setSigningPhase("broadcasting");
      const txHash = await broadcastXlmTransaction(chain.rpcUrl, txBase64);
      fetch(apiUrl("/api/sign/broadcast"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ keyShareId: keyFile.id, sessionId, txHash, chainId: chain.id }),
      }).catch(() => {});
      setPendingTxHash(txHash);
      setSigningPhase("polling");
      const result = await waitForXlmConfirmation(chain.rpcUrl, txHash, () => {}, 30, 3000);
      setTxResult({ status: result.confirmed ? "success" : "pending", txHash, blockNumber: result.ledger });
      if (result.confirmed) {
        addToast(t("xlm.tokenEnabledToast"), "success");
        notify({ title: t("notify.txConfirmed"), body: "XLM Trustline" });
      }
      setKeyFile(null);
      setStep("result");
    } catch (err: unknown) {
      setSigningError(friendlyError(err, t));
    } finally {
      clearClientKey(keyFile.id);
    }
  }

  const isCompact = step === "signing" || step === "result";
  const canClose = step !== "signing";

  return (
    <div className={`fixed inset-0 z-50 ${isCompact ? "flex items-center justify-center p-4 bg-black/50" : "bg-surface-secondary overflow-y-auto md:bg-transparent md:overflow-hidden md:flex md:items-center md:justify-center md:p-4"}`}>
      {!isCompact && <div className="hidden md:block absolute inset-0 bg-black/50" onClick={canClose ? onClose : undefined} />}
      {isCompact && <div className="absolute inset-0" onClick={canClose ? onClose : undefined} />}
      <div className={`relative bg-surface-secondary ${isCompact ? "w-full max-w-md rounded-2xl border border-border-primary shadow-xl max-h-[85vh] overflow-hidden" : "min-h-full pb-[env(safe-area-inset-bottom)] md:min-h-0 md:pb-0 md:max-h-[85vh] md:overflow-y-auto md:w-full md:max-w-md md:rounded-2xl md:border md:border-border-primary md:shadow-xl"}`}>

        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b border-border-secondary shrink-0 ${!isCompact ? "pt-[calc(1rem+env(safe-area-inset-top))] md:pt-4" : ""}`}>
          <div className="flex items-center gap-2">
            {(step === "input" || step === "preview") && (
              <button onClick={() => setStep(step === "preview" ? "input" : "select")} className="text-text-muted hover:text-text-secondary transition-colors mr-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h3 className="text-sm font-semibold text-text-primary">
              {step === "select" ? t("xlm.enableToken")
                : step === "input" ? t("xlm.enableSymbol", { symbol: selectedAsset?.symbol })
                : step === "preview" ? t("xlm.reviewTitle")
                : step === "result" ? t("xlm.done")
                : t("xlm.enableSymbol", { symbol: selectedAsset?.symbol })}
            </h3>
          </div>
          {step !== "signing" && (
            <button onClick={onClose} className="text-text-muted hover:text-text-secondary transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Select step */}
        {step === "select" && (
          <div className="p-5 overflow-y-auto flex-1 min-h-0">
            <p className="text-xs text-text-muted mb-3">{t("xlm.selectToken")}</p>
            <div className="space-y-2">
              {chainAssets.map((a) => {
                const isEnabled = enabledAssets.has(`${a.symbol}:${a.contractAddress}`);
                return (
                  <button
                    key={a.id}
                    onClick={() => { setSelectedAsset(a); setStep("input"); }}
                    className="w-full flex items-center gap-3 px-3 py-3 bg-surface-primary border border-border-primary rounded-lg hover:border-blue-500/40 transition-colors text-left"
                  >
                    {a.iconUrl ? (
                      <img src={a.iconUrl} alt={a.symbol} className="w-8 h-8 rounded-full bg-surface-tertiary shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-tertiary shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary">{a.symbol}</p>
                      <p className="text-[11px] text-text-muted truncate">{a.name.replace(/\s*\(?\s*(testnet|devnet)\s*\)?\s*/gi, " ").trim()}</p>
                    </div>
                    {isEnabled ? (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 shrink-0">{t("xlm.enabled")}</span>
                    ) : (
                      <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Input step — key share + from + fee (mirrors Send input step) */}
        {step === "input" && selectedAsset && (
          <>
            <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
              {!hasStoredShare && <KeyShareUpload keyFile={keyFile} onChange={setKeyFile} expectedKeyId={keyId} />}

              {/* From */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">{t("xlm.from")}</label>
                <div className="bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5">
                  <p className="text-xs font-mono text-text-tertiary truncate">{address}</p>
                  <p className="text-[10px] text-text-muted mt-0.5">{chain.displayName}</p>
                </div>
              </div>

              {/* Token being enabled */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">{t("xlm.token")}</label>
                <div className="bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                  {selectedAsset.iconUrl ? (
                    <img src={selectedAsset.iconUrl} alt={selectedAsset.symbol} className="w-7 h-7 rounded-full bg-surface-tertiary shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-surface-tertiary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary">{selectedAsset.symbol}</p>
                    <p className="text-[10px] text-text-muted truncate">{selectedAsset.name.replace(/\s*\(?\s*(testnet|devnet)\s*\)?\s*/gi, " ").trim()}</p>
                  </div>
                </div>
              </div>

              {/* Fee summary — matches Send dialog bottom */}
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] text-text-muted">{t("xlm.estFee")}</span>
                {xlmFeeRate > 0 ? (
                  <span className="text-[11px] tabular-nums text-text-secondary">
                    {(xlmFeeRate / 1e7).toFixed(7)} XLM
                  </span>
                ) : (
                  <span className="text-[10px] text-text-muted animate-pulse">{t("common.estimating")}</span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-border-secondary shrink-0">
              <Button variant="primary" fullWidth disabled={!keyFile && !hasStoredShare} onClick={() => setStep("preview")}>
                <Eye className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("xlm.reviewButton")}
              </Button>
            </div>
          </>
        )}

        {/* Preview step — review summary (mirrors Send review step) */}
        {step === "preview" && selectedAsset && (
          <>
            <div className="p-5 space-y-5 overflow-y-auto flex-1 min-h-0">
              {/* Hero — matches Send review style */}
              <div className="text-center py-2">
                <div className="flex items-center justify-center gap-2 mb-1">
                  {selectedAsset.iconUrl && (
                    <img src={selectedAsset.iconUrl} alt={selectedAsset.symbol} className="w-6 h-6 rounded-full bg-surface-tertiary shrink-0" />
                  )}
                  <p className="text-2xl font-semibold text-text-primary">
                    {t("xlm.enable")} <span className="text-text-tertiary text-sm">{selectedAsset.symbol}</span>
                  </p>
                </div>
                <p className="text-sm text-text-muted">{t("xlm.establishTrustline")}</p>
              </div>

              {/* Account — mirrors From/To in Send review */}
              <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
                <div className="px-3 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-text-muted">{t("xlm.account")}</span>
                  <span className="text-xs font-mono text-text-secondary">{address.slice(0, 8)}...{address.slice(-6)}</span>
                </div>
              </div>

              {/* Details — mirrors Network/fee/gas/total block in Send review */}
              {(() => {
                const feeXlm = xlmFeeRate / 1e7;
                const feeStr = feeXlm.toFixed(7);
                const feeUsd = getUsdValue(feeStr, "XLM", prices);
                return (
                  <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
                    <div className="px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-text-muted">{t("xlm.network")}</span>
                      <span className="text-xs text-text-secondary">{chain.displayName}</span>
                    </div>
                    <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-text-muted">{t("xlm.estimatedFee")}</span>
                      <div className="text-right">
                        <span className="text-xs tabular-nums text-text-secondary font-medium">{feeStr} XLM</span>
                        {feeUsd != null && <span className="text-[10px] text-text-muted ml-1.5">({formatUsd(feeUsd)})</span>}
                      </div>
                    </div>
                    <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-text-muted">{t("xlm.baseFee")}</span>
                      <span className="text-xs tabular-nums text-text-muted">{xlmFeeRate} stroops</span>
                    </div>
                    <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-text-muted font-medium">{t("xlm.totalCost")}</span>
                      <span className="text-xs tabular-nums text-text-primary font-semibold">
                        {feeUsd != null ? formatUsd(feeUsd) : `${feeStr} XLM`}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Balance change — mirrors BalancePreview in Send review */}
              {(() => {
                const feeXlm = xlmFeeRate / 1e7;
                const bal = parseFloat(balance) || 0;
                const newBal = bal - feeXlm;
                const feeUsd = getUsdValue(feeXlm.toFixed(7), "XLM", prices);
                return (
                  <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
                    <div className="px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-text-muted">XLM</span>
                      <span className="text-xs tabular-nums text-text-secondary">
                        {bal.toFixed(5)} <span className="text-text-muted">→</span> <span className="font-medium text-text-primary">{newBal.toFixed(5)}</span>
                      </span>
                    </div>
                    <div className="border-t border-border-secondary px-3 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-text-muted">{t("xlm.change")}</span>
                      <span className="text-xs tabular-nums text-red-400 font-medium">
                        -{feeXlm.toFixed(7)} XLM{feeUsd != null ? ` (${formatUsd(feeUsd)})` : ""}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-border-secondary shrink-0">
              <Button variant="primary" fullWidth onClick={() => guardedSign(executeTrustlineFlow)}>
                <Lock className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("xlm.confirmEnable")}
              </Button>
            </div>
          </>
        )}
        {/* Signing step */}
        {step === "signing" && (
          <div className="p-5">
            {signingError ? (
              <SigningError
                error={signingError}
                onClose={onClose}
                onRetry={() => { setSigningError(null); setStep("preview"); }}
              />
            ) : (
              <div className="py-6">
                {/* Progress bar */}
                <ProgressBar {...progress} minimal={!expert} />

                {/* Phase label */}
                <p className="text-sm font-medium text-text-primary text-center mb-2">
                  {txSigningSteps(t, signLabelActive)[phaseIndex[signingPhase]].label}
                </p>
                <p className="text-[11px] text-text-muted text-center mb-6">
                  {t("xlm.enableTrustline", { symbol: selectedAsset?.symbol })}
                </p>

                <SigningStepper steps={txSigningSteps(t, signLabelActive)} currentIndex={phaseIndex[signingPhase]} />

                {/* Tx hash card (visible during Confirming step) */}
                {pendingTxHash && signingPhase === "polling" && (
                  <a
                    href={explorerLink(chain.explorerUrl, `/tx/${pendingTxHash}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between mt-5 mx-auto max-w-[260px] px-3 py-2.5 rounded-lg bg-surface-primary/60 border border-border-secondary hover:border-blue-500/30 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] text-text-muted shrink-0">Tx</span>
                      <span className="text-xs font-mono text-text-secondary truncate">{pendingTxHash.slice(0, 16)}...</span>
                    </div>
                    <svg className="w-3.5 h-3.5 text-text-muted group-hover:text-blue-400 shrink-0 ml-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Result step */}
        {step === "result" && txResult && (
          <div className="p-5">
            <div className="text-center py-6">
              {txResult.status === "success" ? (
                <>
                  <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-text-primary mb-1">{selectedAsset?.symbol} Enabled</p>
                  <p className="text-sm text-text-muted">You can now receive {selectedAsset?.symbol} on Stellar</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-text-primary mb-1">Transaction Broadcast</p>
                  <p className="text-[11px] text-text-muted">Waiting for confirmation...</p>
                </>
              )}
              <div className="mt-4 mx-auto max-w-[280px] rounded-lg bg-surface-primary/60 border border-border-secondary overflow-hidden">
                <a href={explorerLink(chain.explorerUrl, `/tx/${txResult.txHash}`)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 hover:bg-surface-tertiary/50 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-text-muted shrink-0">Tx</span>
                    <span className="text-xs font-mono text-text-secondary truncate">{txResult.txHash.slice(0, 16)}...</span>
                  </div>
                  <svg className="w-3.5 h-3.5 text-text-muted group-hover:text-blue-400 shrink-0 ml-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
            <div className="border-t border-border-secondary pt-4">
              <Button variant="secondary" fullWidth onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>

      {passkeyGuard === "gate" && (
        <PasskeyGate onRegistered={onPasskeyComplete} onCancel={() => { setPasskeyGuard("idle"); pendingSignRef.current = null; }} />
      )}
    </div>
  );
}
