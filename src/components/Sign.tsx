import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ExpertPhishingWarning } from "./expert-phishing-warning";
import { trackExpertTool } from "../lib/expert-usage";
import { toHex, sha256, performMpcSign, clientKeys, restoreKeyHandles } from "../lib/mpc";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sensitiveHeadersFor } from "../lib/passkey";
import { usePasskeyPresence } from "./use-passkey-presence";
import { parseDerSignature } from "../lib/chains/evmTx";
import { hexToBytes } from "../shared/utils";
import { PasskeyGate } from "./PasskeyGate";
import { listKeyShares, type KeyShareInfo } from "../lib/keystore";
import { resolveSigningKeyFile } from "../lib/signing-key-file";
import { KeyPassphraseCancelled, cancelKeyPassphrase } from "../lib/key-passphrase-prompt";
import { KeyShareUpload } from "./KeyShareUpload";
import { useFrozen } from "../context/FrozenContext";
import { isRecoveryMode, getRecoveryKeyFile } from "../lib/recovery";
import { useSteppedProgress, signingDurationMs, ProgressBar } from "./ProgressBar";
import { PenLine, CircleX, CircleCheck, Clock } from "lucide-react";

interface KeyFile {
  id: string;
  peer: number;
  share: string;
  publicKey: string;
  eddsaShare: string;
  eddsaPublicKey: string;
}

type SigningPhase = "loading" | "signing" | "verifying";

function getPhaseLabels(t: (k: string) => string, pct?: number): Record<SigningPhase, string> {
  const signLabel = isRecoveryMode() ? t("sign.localSigning") : t("sign.mpcSigning");
  const signLabelActive = pct != null && pct > 0 ? `${signLabel} ${pct}%` : signLabel;
  return { loading: t("sign.prepare"), signing: signLabelActive, verifying: t("sign.verify") };
}

const phases: SigningPhase[] = ["loading", "signing", "verifying"];

export function Sign() {
  const { t } = useTranslation();
  const frozen = useFrozen();
  // An uploaded key file, or recovery mode's share; else the device share of signKeyId signs.
  const [uploadedKeyFile, setUploadedKeyFile] = useState<KeyFile | null>(() => {
    if (isRecoveryMode()) {
      const kf = getRecoveryKeyFile();
      if (kf) return kf as KeyFile;
    }
    return null;
  });
  const [message, setMessage] = useState("");
  const [algorithm, setAlgorithm] = useState<"ecdsa" | "eddsa">("ecdsa");

  // Browser-stored key shares: one is implicit; a grandfathered second key is chosen here
  // (this page has no account row to name it). Nothing unlocks until the sign tap.
  const [browserShares] = useState<KeyShareInfo[]>(() => (isRecoveryMode() ? [] : listKeyShares()));
  const [signKeyId, setSignKeyId] = useState<string | null>(() => browserShares[0]?.keyId ?? null);
  // A key kept as a file only can still sign here, next to the stored ones.
  const [showUpload, setShowUpload] = useState(false);
  // Owner of this flow's passphrase prompt: unmounting cancels it (and only it).
  const [passphraseOwner] = useState(() => ({}));
  useEffect(() => () => cancelKeyPassphrase(passphraseOwner), [passphraseOwner]);

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [signingPhase, setSigningPhase] = useState<SigningPhase>("loading");
  const [signingError, setSigningError] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [verified, setVerified] = useState<boolean | null>(null);
  // Stepped progress: phases are loading(0) → signing(1) → verifying(2)
  const signPhaseIdx = phases.indexOf(signingPhase);
  const progress = useSteppedProgress(
    showDialog && !signature && !signingError ? signPhaseIdx : -1,
    1, // main step = MPC signing (index 1)
    1, // 1 step after main: verify
    signingDurationMs(1),
    false,
  );

  // Passkey guard state
  const [passkeyGuard, setPasskeyGuard] = useState<"idle" | "gate">("idle");
  const { hasPasskey, markRegistered } = usePasskeyPresence();

  /** The share that signs, kept for a sign that waits on the passkey registration gate. */
  const pendingKeyRef = useRef<KeyFile | null>(null);

  async function guardedSign() {
    if (!message) return;
    // The share that signs: an uploaded/recovery file, else this device's share of signKeyId
    // (a passphrase share asks for its passphrase here; a PRF share stays locked until the tap).
    // Resolved first, while the click's user activation is still fresh.
    let keyFile: KeyFile | null;
    try {
      keyFile = await resolveSigningKeyFile(signKeyId ?? "", { needsEddsa: algorithm === "eddsa", uploaded: uploadedKeyFile, owner: passphraseOwner });
    } catch (err: unknown) {
      if (err instanceof KeyPassphraseCancelled) return;
      setShowDialog(true);
      setSignature("");
      setSigningError(signErrorText(err));
      return;
    }
    if (!keyFile) return;
    if (isRecoveryMode()) {
      sign(keyFile);
      return;
    }
    // The signing step asks for the passkey itself (bound to this message's digest).
    if (await hasPasskey()) {
      sign(keyFile);
    } else {
      pendingKeyRef.current = keyFile;
      setPasskeyGuard("gate");
    }
  }

  async function sign(keyFile: KeyFile) {
    setShowDialog(true);
    setSignature("");
    setVerified(null);
    setSigningError(null);
    setSigningPhase("loading");

    try {
      // Restore key handles from file if not in memory
      if (!clientKeys.has(keyFile.id)) {
        await restoreKeyHandles(keyFile.id, keyFile.share, keyFile.eddsaShare);
      }

      const hash = await sha256(message);
      const useEddsa = algorithm === "eddsa";

      setSigningPhase("signing");

      const { signature: sigRaw } = await performMpcSign({
        algorithm: useEddsa ? "eddsa" : "ecdsa",
        keyId: keyFile.id,
        hash,
        initPayload: { id: keyFile.id, raw: message, algorithm: useEddsa ? "eddsa" : "ecdsa" },
        headers: await sensitiveHeadersFor(keyFile.id),
      });

      setSignature(toHex(sigRaw));
      trackExpertTool("raw_sign");

      // Verify
      setSigningPhase("verifying");

      if (useEddsa) {
        // EdDSA verification — trust server for now
        setVerified(true);
      } else {
        try {
          const { r, s } = parseDerSignature(sigRaw);
          const pubKeyRaw = hexToBytes(keyFile.publicKey);
          const compactSig = new Uint8Array(64);
          compactSig.set(bigIntTo32Bytes(r), 0);
          compactSig.set(bigIntTo32Bytes(s), 32);
          const isValid = secp256k1.verify(compactSig, hash, pubKeyRaw, { prehash: false });
          setVerified(isValid);
        } catch {
          setVerified(false);
        }
      }
    } catch (err: unknown) {
      console.error("[sign] Error:", err);
      setSigningError(signErrorText(err));
    }
  }

  function signErrorText(err: unknown): string {
    const msg = (err as { message?: string })?.message || String(err);
    return msg === "passkey_auth_required" ? t("sign.passkeyExpired") : msg === "prf_unavailable" ? t("send.passkeyNoEncryption") : msg;
  }

  function closeDialog() {
    setShowDialog(false);
  }

  const signDialogCanClose = !!(signature || signingError);

  useEffect(() => {
    if (!showDialog) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && signDialogCanClose) closeDialog();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDialog, signDialogCanClose]);

  const canSign = (uploadedKeyFile || signKeyId) && message;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="pt-2 pb-2">
        <h2 className="text-lg font-semibold text-text-primary">{t("sign.title")}</h2>
        <p className="text-xs text-text-muted mt-1">
          {t("sign.desc")}
        </p>
      </div>

      <ExpertPhishingWarning kind="sign" />

      {/* Form */}
      <div className="space-y-4">
        {/* Key share: implicit with one device share; a file upload when there is none */}
        {browserShares.length > 1 && !uploadedKeyFile && (
          <div>
            <label className="block text-xs text-text-muted mb-1.5">{t("signKey.label")}</label>
            <div className="flex flex-wrap bg-surface-secondary border border-border-primary rounded-lg p-0.5 gap-0.5 w-fit">
              {browserShares.map((s) => (
                <button
                  key={s.keyId}
                  onClick={() => setSignKeyId(s.keyId)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    signKeyId === s.keyId ? "bg-surface-tertiary text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {s.name || `${s.keyId.slice(0, 8)}...`}
                </button>
              ))}
            </div>
          </div>
        )}
        {!isRecoveryMode() && (browserShares.length === 0 || showUpload || uploadedKeyFile ? (
          <KeyShareUpload keyFile={uploadedKeyFile} onChange={setUploadedKeyFile} />
        ) : (
          <button onClick={() => setShowUpload(true)} className="text-[11px] text-text-muted hover:text-text-tertiary transition-colors">
            {t("signKey.orUploadFile")}
          </button>
        ))}

        {/* Algorithm */}
        <div>
          <label className="block text-xs text-text-muted mb-1.5">{t("sign.algorithm")}</label>
          <div className="flex bg-surface-secondary border border-border-primary rounded-lg p-0.5 gap-0.5 w-fit">
            {(["ecdsa", "eddsa"] as const).map((algo) => (
              <button
                key={algo}
                onClick={() => setAlgorithm(algo)}
                className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  algorithm === algo
                    ? "bg-surface-tertiary text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {algo.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Message */}
        <div>
          <label className="block text-xs text-text-muted mb-1.5">{t("sign.message")}</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t("sign.messagePlaceholder")}
            rows={4}
            className="w-full bg-surface-secondary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors resize-none"
          />
        </div>

        {/* Sign Button */}
        <button
          onClick={guardedSign}
          disabled={!canSign || frozen}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted disabled:cursor-not-allowed px-6 py-2.5 rounded-lg font-medium text-sm transition-colors text-white"
        >
          <PenLine className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("sign.signButton")}
        </button>
      </div>

      {/* Passkey guard dialogs */}
      {passkeyGuard === "gate" && (
        <PasskeyGate
          onRegistered={() => {
            markRegistered();
            setPasskeyGuard("idle");
            const kf = pendingKeyRef.current;
            pendingKeyRef.current = null;
            if (kf) sign(kf);
          }}
          onCancel={() => { setPasskeyGuard("idle"); pendingKeyRef.current = null; }}
        />
      )}

      {/* Signing Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={signature || signingError ? closeDialog : undefined} />
          <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-md shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
              <h3 className="text-sm font-semibold text-text-primary">
                {signingError ? <><CircleX className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("sign.signingFailed")}</> : signature ? <><CircleCheck className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("sign.signatureResult")}</> : <><Clock className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("sign.signing")}</>}
              </h3>
              {(signature || signingError) && (
                <button
                  onClick={closeDialog}
                  className="p-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Body */}
            <div className="px-5 py-5">
              {signingError ? (
                /* Error state */
                <div className="text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-text-primary mb-1">{t("sign.signingFailed")}</p>
                  <p className="text-xs text-red-400 break-all mb-5">{signingError}</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={closeDialog}
                      className="px-4 py-2 rounded-lg text-xs font-medium bg-surface-tertiary text-text-secondary hover:bg-border-primary transition-colors"
                    >
                      {t("common.close")}
                    </button>
                    <button
                      onClick={() => { closeDialog(); setTimeout(sign, 100); }}
                      className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                    >
                      {t("common.tryAgain")}
                    </button>
                  </div>
                </div>
              ) : signature ? (
                /* Result state */
                <div className="py-2">
                  <div className="text-center mb-5">
                    <div className={`w-14 h-14 rounded-full ${verified ? "bg-green-500/10" : "bg-red-500/10"} flex items-center justify-center mx-auto mb-3`}>
                      {verified ? (
                        <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      ) : (
                        <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-text-primary">
                      {verified ? t("sign.signatureVerified") : t("sign.verificationFailed")}
                    </p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      {algorithm.toUpperCase()} {verified ? t("sign.signatureValid") : t("sign.signatureInvalid")}
                    </p>
                  </div>

                  {/* Signature details */}
                  <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-border-secondary">
                      <p className="text-[10px] text-text-muted mb-1">{t("sign.message")}</p>
                      <p className="text-xs text-text-secondary break-all line-clamp-2">{message}</p>
                    </div>
                    <div className="px-3 py-2.5 border-b border-border-secondary">
                      <p className="text-[10px] text-text-muted mb-1">{t("sign.algorithm")}</p>
                      <p className="text-xs text-text-secondary">{algorithm.toUpperCase()}</p>
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-[10px] text-text-muted mb-1">{t("sign.signatureLabel")}</p>
                      <p className="text-[10px] font-mono text-yellow-400 break-all leading-relaxed">{signature}</p>
                    </div>
                  </div>
                </div>
              ) : (
                /* Signing progress state */
                <div className="py-6">
                  <p className="text-sm font-medium text-text-primary text-center mb-1">
                    {getPhaseLabels(t, progress.phase === "main" ? progress.pct : undefined)[signingPhase]}
                  </p>
                  <p className="text-[11px] text-text-muted text-center mb-4">
                    {algorithm.toUpperCase()} {t("sign.signingInProgress")}
                  </p>

                  {/* Progress bar */}
                  <div className="mb-5">
                    <ProgressBar {...progress} />
                  </div>

                  <div className="space-y-2 max-w-[220px] mx-auto">
                    {phases.map((phase) => {
                      const currentIdx = phases.indexOf(signingPhase);
                      const idx = phases.indexOf(phase);
                      const isDone = currentIdx > idx;
                      const isCurrent = signingPhase === phase;
                      return (
                        <div key={phase} className="flex items-center gap-2.5">
                          {isDone ? (
                            <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          ) : isCurrent ? (
                            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                            </div>
                          ) : (
                            <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                              <div className="w-1.5 h-1.5 rounded-full bg-surface-tertiary" />
                            </div>
                          )}
                          <span className={`text-xs ${isDone ? "text-text-tertiary" : isCurrent ? "text-text-secondary" : "text-text-muted"}`}>
                            {getPhaseLabels(t, progress.phase === "main" ? progress.pct : undefined)[phase]}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer for result state */}
            {signature && (
              <div className="px-5 py-4 border-t border-border-secondary">
                <button
                  onClick={closeDialog}
                  className="w-full py-2.5 rounded-lg text-xs font-medium bg-surface-tertiary text-text-secondary hover:bg-border-primary transition-colors"
                >
                  {t("common.done")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  const result = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    result[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return result;
}
