import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../context/ToastContext";
import { notify } from "../lib/notify";
import { wcService } from "../lib/walletconnect";
import { useNavigate } from "react-router-dom";
import type { PendingRequest } from "../context/WalletConnectContext";
import type { KeyShare, Chain, Asset } from "../shared/types";
import { authHeaders, getMe } from "../lib/auth";
import { apiUrl } from "../lib/apiBase";
import { fetchChains, fetchAssets } from "../lib/api";
import { applyChainOverrides } from "../lib/userOverrides";
import { getChainAdapter } from "../lib/chains/adapter";
import { PassphraseInput } from "./PassphraseInput";
import type { PasskeyAuthResult } from "../lib/passkey";
import { authenticatePasskey } from "../lib/passkey";
import { hasKeyShare, getKeyShareMode, getKeyShareWithPrf, getKeyShareWithPassphrase, deferredPrfKeyFile } from "../lib/keystore";
import { decryptKeyFile, isEncryptedKeyFile, type KeyFileData } from "../lib/crypto";
import { isRecoveryMode, getRecoveryKeys, getRecoveryKeyFile } from "../lib/recovery";
import { wcPersonalSign, wcEthSign, wcSignTypedData, wcSendTransaction, wcSolanaSignTransaction, wcSolanaSignAndSendTransaction, wcSolanaSignMessage, isSignableSolanaMessage, wcTronSignTransaction, wcTronSignMessage, type WcSignPhase } from "../lib/wcSigning";
import { decodeSolanaMessageParam } from "../lib/solana-wc-message";
import { evmReceiptRpcUrls } from "../lib/chains/evm-read-rpc-fallbacks";
import { usePendingEvmReceipt } from "./send/use-pending-evm-receipt";
import { waitForReceipt, estimateGas, getTransactionCount } from "../lib/chains/evmTx";
import { solanaSolOutflow } from "../lib/chains/solanaIx";
import { decodeSolanaTransaction, formatLamports, waitForSolanaConfirmation, type DecodedSolanaTx } from "../lib/chains/solanaTx";
import { formatSun, waitForTronConfirmation, estimateTronFee } from "../lib/chains/tronTx";
import { parseTronSignTransaction, parseTronSignMessage, type TronSignTransactionRequest } from "../lib/tron-wc-requests";
import { fetchPrices } from "../lib/prices";
import { fetchNativeBalance, getCachedNativeBalance, fetchTokenBalances } from "../lib/balance";
import { clearCache, tokenBalancesCacheKey, notifyBalanceRefresh } from "../lib/dataCache";
import type { BalanceResult } from "../lib/balance";
import { explorerLink } from "../shared/utils";
import { useSteppedProgress, signingDurationMs, ProgressBar } from "./ProgressBar";
import { BalancePreview, type BalanceChange } from "./BalancePreview";
import { simulateEvmTransaction, type SimulationResult } from "../lib/txSimulation";
import { useExpertMode } from "../context/ExpertModeContext";
import { PolicyWarning, ExpertWarnings, SimulationPreview, SigningError, SigningStepper } from "./tx";
import { ReviewBody, useScrollGate, DappTitle, NetworkChip, AllowanceEditor } from "./review";
import { buildWcRequestReview, decodeEvmCall, knownEvmContract, withEvmApproveAmount, withTronApproveAmount, type ReviewModel, type TronTxJson, type WcReviewContext } from "../lib/review";
import { addressLabel } from "../lib/address-label";
import { KNOWN_PROGRAMS } from "../lib/chains/solanaTx";
import { isKnownRecipient } from "./send/use-first-time-recipient";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import { Clock, CircleCheck, Radio, CircleX, Eye } from "lucide-react";

function friendlyError(err: unknown, t: (k: string) => string): string {
  const msg = (err as { message?: string })?.message || String(err);
  if (msg === "passkey_auth_required") return t("wc.passkeyExpired");
  if (msg === "prf_unavailable") return t("send.passkeyNoEncryption");
  return msg;
}

interface Props {
  request: PendingRequest;
  onApprove: (result: unknown) => void;
  onReject: () => void;
  onDismiss?: () => void;
}

interface ResolvedAccount {
  keyId: string;
  address: string;
  keyName: string;
  hasStored: boolean;
  storedMode: "prf" | "passphrase" | null;
}

// ── Fee constants ────────────────────────────────────────────────
type FeeLevel = "low" | "medium" | "high";
const FEE_LABEL_KEYS: Record<FeeLevel, string> = { low: "send.feeSlow", medium: "send.feeStandard", high: "send.feeFast" };
const FEE_MULTIPLIER: Record<FeeLevel, number> = { low: 0.8, medium: 1.0, high: 1.3 };
const GAS_LIMIT_DEFAULT = 21_000n;
const GAS_LIMIT_CONTRACT = 200_000n;

const MAX_UINT256 = 2n ** 256n - 1n;

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (amount === MAX_UINT256) return "Unlimited";
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function formatGwei(wei: bigint): string {
  const gwei = Number(wei) / 1e9;
  return gwei < 0.01 ? "< 0.01" : gwei.toFixed(2);
}

// ── Component ────────────────────────────────────────────────────

export function WCRequestApproval({ request, onApprove, onReject, onDismiss }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const expert = useExpertMode();
  const { addToast } = useToast();
  // Phases: review → preview → signing → done
  // Signing asks for the passkey once: bound to this request's digests, and (for a PRF
  // browser share) unlocking the share in the same prompt.
  const [phase, setPhase] = useState<"review" | "preview" | "passkey" | "signing" | "done" | "error">("review");
  // Toast on completion
  useEffect(() => {
    if (phase === "done" && txResult) {
      addToast(txResult.status === "success" ? t("wc.txConfirmed") : t("wc.txSubmitted"), txResult.status === "success" ? "success" : "info");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const [error, setError] = useState("");
  const [txResult, setTxResult] = useState<{ txHash: string; status: "success" | "pending" | "failed"; blockNumber?: string } | null>(null);

  const [account, setAccount] = useState<ResolvedAccount | null>(null);
  const [chains, setChains] = useState<Chain[]>([]);
  const [keyFile, setKeyFile] = useState<KeyFileData | null>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<KeyFileData | null>(null);
  const [browserShareLoading, setBrowserShareLoading] = useState(false);
  const [browserShareError, setBrowserShareError] = useState("");
  const [showBrowserPassphrase, setShowBrowserPassphrase] = useState(false);
  const [signingStepIdx, setSigningStepIdx] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fee state (for eth_sendTransaction)
  const [baseGasPrice, setBaseGasPrice] = useState<bigint | null>(null);
  const [feeLevel, setFeeLevel] = useState<FeeLevel>("medium");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [gasLimitInput, setGasLimitInput] = useState<string>("");
  const [maxFeeOverride, setMaxFeeOverride] = useState("");
  const [priorityFeeOverride, setPriorityFeeOverride] = useState("");
  // Spending cap the user set in the editor (review-and-sign.md "Spending cap"); null = the dApp's request.
  const [approveOverride, setApproveOverride] = useState<bigint | null>(null);
  const [capInvalid, setCapInvalid] = useState(false);
  const [approveToken, setApproveToken] = useState<{ symbol: string; decimals: number } | null>(null);
  const [permitToken, setPermitToken] = useState<{ symbol: string; decimals: number } | null>(null);
  const [nativeBalance, setNativeBalance] = useState<string | null>(null); // raw wei as string
  const [tokenBalances, setTokenBalances] = useState<BalanceResult[]>([]);
  const [chainAssets, setChainAssets] = useState<Asset[]>([]);

  const isSolana = request.method.startsWith("solana_");
  const isSolanaTx = request.method === "solana_signTransaction" || request.method === "solana_signAndSendTransaction";
  const isTron = request.method.startsWith("tron_");
  const isTronTx = request.method === "tron_signTransaction";
  const isTx = request.method === "eth_sendTransaction" || isSolanaTx || isTronTx;

  // Stepped progress: 90% for MPC signing, 10% for other steps (1s each)
  const wcStepsAfterMain = isTx ? 2 : 1; // tx: broadcast+confirm; msg: verify
  const progress = useSteppedProgress(
    phase === "signing" ? signingStepIdx : -1,
    1, // main step = MPC signing (index 1)
    wcStepsAfterMain,
    signingDurationMs(1),
    false,
  );

  // TRON state
  const [tronResources, setTronResources] = useState<{ bandwidthFree: number; energyFree: number } | null>(null);
  const [tronTokenInfo, setTronTokenInfo] = useState<{ symbol: string; decimals: number } | null>(null);

  // TRON: what the signed bytes (raw_data_hex) do, never the dApp's JSON raw_data view of them. A request whose
  // bytes are not one TRX / TRC-20 transfer or TRC-20 approve of the session account cannot be signed.
  const tronParsed = useMemo((): { req: TronSignTransactionRequest | null; error: string | null } => {
    if (!isTronTx) return { req: null, error: null };
    try {
      return { req: parseTronSignTransaction(request.params, request.params?.account ?? ""), error: null };
    } catch (e) {
      return { req: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [isTronTx, request.params]);
  const tronDecoded = tronParsed.req?.decoded ?? null;
  const isTronNative = tronDecoded?.kind === "trx_transfer";
  const isTronSmartContract = !!tronDecoded && tronDecoded.kind !== "trx_transfer";
  const isTrc20Transfer = tronDecoded?.kind === "trc20_transfer";
  const tronAmountSun = isTronNative ? tronDecoded!.amount : 0n;
  const tronTokenAmount = isTronSmartContract ? tronDecoded!.amount : 0n;
  const tronTokenContract = tronDecoded?.contractAddress ?? null;
  // Fee limit (TRON's equivalent of gas limit — max TRX burned for energy), from the signed bytes
  const tronFeeLimitSun = tronDecoded && tronDecoded.feeLimit > 0n ? tronDecoded.feeLimit : null;

  // Estimated fee: native TRX uses bandwidth (free if available), TRC-20 uses energy (~15 TRX)
  const tronEstFeeSun = isTronNative ? 0n : 15_000_000n;

  // Decode Solana transaction for display
  const [decodedSolTx, setDecodedSolTx] = useState<DecodedSolanaTx | null>(null);
  useEffect(() => {
    if (!isSolanaTx) return;
    try {
      const txBase64 = request.params?.transaction;
      if (txBase64) setDecodedSolTx(decodeSolanaTransaction(txBase64));
    } catch {
      // If decode fails, show raw
    }
  }, [isSolanaTx, request.params?.transaction]);

  // Resolve which chain this request targets
  const namespace = request.chainId?.split(":")[0] || "eip155";
  const chainId = namespace === "eip155" ? parseInt(request.chainId?.split(":")[1] || "1") : 0;
  const tronChainRef = namespace === "tron" ? request.chainId?.split(":")[1] : null;
  const chain = isSolana
    ? chains.find((c) => c.type === "solana")
    : isTron
      ? chains.find((c) => c.type === "tron" && (tronChainRef ? c.id === tronChainRef : true))
        || chains.find((c) => c.type === "tron")
      : chains.find((c) => c.evmChainId === chainId);

  // Broadcast but receipt unknown (RPC errors / slow chain): keep polling in the background.
  const receiptGaveUp = usePendingEvmReceipt(
    phase === "done" && txResult?.status === "pending" && chain?.type === "evm",
    chain,
    txResult?.txHash,
    (r) => setTxResult((prev) => (prev ? { ...prev, status: r.status, blockNumber: r.blockNumber } : prev)),
  );

  // Resolve SPL token info (symbol, decimals) from chain assets
  const [solTokenInfo, setSolTokenInfo] = useState<{ symbol: string; decimals: number } | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!decodedSolTx?.mint || !chain) return;
    fetchAssets(chain.id).then((assets) => {
      const token = assets.find(
        (a) => a.contractAddress?.toLowerCase() === decodedSolTx.mint!.toLowerCase()
      );
      if (token) setSolTokenInfo({ symbol: token.symbol, decimals: token.decimals });
    });
  }, [decodedSolTx?.mint, chain?.id]);

  // Notify on tx confirmation
  useEffect(() => {
    if (txResult?.status === "success") {
      const dappName = wcService.getSessions().find((s) => s.topic === request.topic)?.peer.metadata.name || "dApp";
      notify({
        title: t("notify.txConfirmed"),
        body: dappName,
        path: "/accounts",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txResult?.status]);

  // Fetch TRON account resources (bandwidth/energy) for fee display
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isTronTx || !account || !chain?.rpcUrl) return;
    estimateTronFee(chain.rpcUrl, account.address).then(setTronResources).catch(() => {});
  }, [isTronTx, account?.address, chain?.rpcUrl]);

  // Resolve TRC-20 token info from chain assets
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isTronSmartContract || !chain) return;
    const contractAddr = tronTokenContract;
    if (!contractAddr) return;
    fetchAssets(chain.id).then((assets) => {
      const token = assets.find(
        (a) => a.contractAddress?.toLowerCase() === contractAddr.toLowerCase()
      );
      if (token) setTronTokenInfo({ symbol: token.symbol, decimals: token.decimals });
    });
  }, [isTronSmartContract, tronTokenContract, chain?.id]);

  // Gas limit: use user override, estimated, dApp's value, or heuristic
  const txParams = isTx && !isTronTx ? request.params[0] : null;
  const dappGasLimit = txParams?.gasLimit
    ? BigInt(txParams.gasLimit)
    : txParams?.gas
      ? BigInt(txParams.gas)
      : (txParams?.data && txParams.data !== "0x" ? GAS_LIMIT_CONTRACT : GAS_LIMIT_DEFAULT);

  const [estimatedGasLimit, setEstimatedGasLimit] = useState<bigint | null>(null);
  const [currentNonce, setCurrentNonce] = useState<number | null>(null);

  // Fetch estimated gas and nonce for EVM transactions
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isSolana || !isTx || !txParams?.to || !chain?.rpcUrl || !account) return;
    estimateGas(chain.rpcUrl, {
      from: account.address,
      to: txParams.to,
      value: txParams.value || "0x0",
      data: txParams.data || undefined,
    }).then(setEstimatedGasLimit).catch(() => {});
    getTransactionCount(chain.rpcUrl, account.address).then(setCurrentNonce).catch(() => {});
  }, [isTx, isSolana, txParams?.to, txParams?.value, txParams?.data, chain?.rpcUrl, account?.address]);

  const defaultGasLimit = estimatedGasLimit ?? dappGasLimit;
  const gasLimit = gasLimitInput && /^\d+$/.test(gasLimitInput) ? BigInt(gasLimitInput) : defaultGasLimit;

  // ERC-20 approve detection
  // Same decoder as the review (and the API policy): only a plain ERC-20 approve has an editable cap.
  const evmCall = txParams?.data ? decodeEvmCall(txParams.data, txParams.from, txParams.to) : null;
  const isApprove = evmCall?.kind === "approve" && evmCall.plain;

  const gasPrice = maxFeeOverride && /^\d+(\.\d+)?$/.test(maxFeeOverride)
    ? BigInt(Math.round(parseFloat(maxFeeOverride) * 1e9))
    : baseGasPrice != null
      ? BigInt(Math.round(Number(baseGasPrice) * FEE_MULTIPLIER[feeLevel]))
    : null;
  const estimatedFeeWei = gasPrice != null ? gasPrice * gasLimit : null;

  // Resolve account from request
  useEffect(() => {
    const address = getRequestAddress(request);
    if (!address) return;

    const keysPromise = isRecoveryMode()
      ? Promise.resolve(getRecoveryKeys())
      : fetch(apiUrl("/api/keys"), { headers: authHeaders() })
          .then((r) => r.json())
          .then((d) => (d.keys || []) as KeyShare[]);

    Promise.all([keysPromise, fetchChains(), getMe()]).then(async ([keys, allChains, me]) => {
      // Apply user config overrides (expert-only: custom RPC URLs)
      const mergedChains = applyChainOverrides(allChains, me?.id);
      setChains(mergedChains);

      for (const key of keys) {
        if (!key.enabled) continue;

        let derived: string | null = null;
        if (isSolana) {
          if (!key.eddsaPublicKey) continue;
          const solanaAdapter = getChainAdapter("solana");
          derived = solanaAdapter.deriveAddress(key.eddsaPublicKey);
        } else if (isTron) {
          if (!key.publicKey) continue;
          const tronAdapter = getChainAdapter("tron");
          derived = tronAdapter.deriveAddress(key.publicKey);
        } else {
          if (!key.publicKey) continue;
          const evmAdapter = getChainAdapter("evm");
          derived = evmAdapter.deriveAddress(key.publicKey);
        }

        if (derived && derived.toLowerCase() === address.toLowerCase()) {
          if (isRecoveryMode()) {
            // In recovery mode, key file is already in memory
            setAccount({
              keyId: key.id,
              address: derived,
              keyName: key.name || `Key ${key.id.slice(0, 8)}`,
              hasStored: true,
              storedMode: null,
            });
            setKeyFile(getRecoveryKeyFile());
          } else {
            const stored = await hasKeyShare(key.id);
            const mode = stored ? await getKeyShareMode(key.id) : null;
            setAccount({
              keyId: key.id,
              address: derived,
              keyName: key.name || `Key ${key.id.slice(0, 8)}`,
              hasStored: stored,
              storedMode: mode,
            });
          }
          return;
        }
      }
    });
  }, [request]);

  // Resolve token info for ERC-20 approve calls
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isApprove || !txParams?.to || !chain) return;
    fetchAssets(chain.id).then((assets) => {
      const token = assets.find(
        (a) => a.contractAddress?.toLowerCase() === txParams.to.toLowerCase()
      );
      // Unknown token: no decimals, so the cap cannot be edited (the review shows raw units).
      setApproveToken(token ? { symbol: token.symbol, decimals: token.decimals } : { symbol: "tokens", decimals: 18 });
    });
  }, [isApprove, txParams?.to, chain?.id]);

  // Resolve token info for EIP-712 Permit typed data
  useEffect(() => {
    if (request.method !== "eth_signTypedData_v4" || !chain) return;
    try {
      const parsed = typeof request.params[1] === "string" ? JSON.parse(request.params[1]) : request.params[1];
      const contract = parsed.domain?.verifyingContract;
      if (!contract || (parsed.primaryType !== "Permit" && parsed.primaryType !== "PermitSingle" && parsed.primaryType !== "PermitBatch")) return;
      // For PermitSingle/Batch the token is in details, for Permit the contract IS the token
      const tokenAddr = parsed.primaryType === "Permit" ? contract : parsed.message?.details?.token;
      if (!tokenAddr) return;
      fetchAssets(chain.id).then((assets) => {
        const token = assets.find((a) => a.contractAddress?.toLowerCase() === tokenAddr.toLowerCase());
        setPermitToken(token ? { symbol: token.symbol, decimals: token.decimals } : { symbol: "tokens", decimals: 18 });
      });
    } catch { /* ignore parse errors */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.method, chain?.id]);

  // Fetch native + token balances for preview
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!account || !chain) return;
    fetchAssets(chain.id).then((assets) => {
      setChainAssets(assets);
      // Try cached first for instant display
      const cached = getCachedNativeBalance(account.address, chain, assets);
      if (cached) setNativeBalance(cached.data.balance);
      // Fetch fresh native
      fetchNativeBalance(account.address, chain, assets).then((result) => {
        if (result) setNativeBalance(result.balance);
      });
      // Fetch token balances
      fetchTokenBalances(account.address, chain, assets).then((results) => {
        setTokenBalances(results);
      });
    });
  }, [account?.address, chain?.id]);

  // Fetch gas price and USD prices (for fee estimation)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    fetchPrices().then(setPrices);
    if (!isTx) return;

    // Gas price polling is EVM-only
    if (!chain || chain.type !== "evm") return;

    function refreshGasPrice() {
      const rpcUrl = chain?.rpcUrl;
      if (!rpcUrl) return;
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.result) setBaseGasPrice(BigInt(data.result));
        })
        .catch(() => {});
    }

    refreshGasPrice();
    const feeIv = setInterval(refreshGasPrice, 10_000);
    return () => clearInterval(feeIv);
  }, [isTx, isSolana, chain?.rpcUrl]);

  function getRequestAddress(req: PendingRequest): string | null {
    switch (req.method) {
      case "eth_sendTransaction":
        return req.params?.[0]?.from || null;
      case "personal_sign":
        return req.params?.[1] || null;
      case "eth_sign":
        return req.params?.[0] || null;
      case "eth_signTypedData_v4":
        return req.params?.[0] || null;
      case "solana_signTransaction":
      case "solana_signAndSendTransaction":
        // Address comes from the session account, extract from chainId
        return req.params?.account || null;
      case "solana_signMessage":
        return req.params?.pubkey || req.params?.account || null;
      case "tron_signTransaction":
      case "tron_signMessage":
        return req.params?.account || null;
      default:
        return null;
    }
  }

  // ── Key share loading (passkey #1 for decrypt) ─────────────────

  /** Load browser-stored key share — triggers passkey #1 for PRF decrypt */
  async function loadBrowserShare() {
    if (!account) return;
    setBrowserShareLoading(true);
    setBrowserShareError("");
    try {
      // PRF share: keep it locked; the signing tap unlocks it (one tap per request).
      const deferred = account.storedMode === "prf" ? deferredPrfKeyFile(account.keyId, { needsEddsa: isSolana }) : null;
      if (deferred) {
        setKeyFile(deferred);
      } else if (account.storedMode === "prf") {
        const result = await authenticatePasskey({ withPrf: true });
        if (result.prfKey) {
          const data = await getKeyShareWithPrf(account.keyId, result.prfKey);
          if (data) {
            setKeyFile(data);
            setBrowserShareLoading(false);
            return;
          }
          setBrowserShareError(t("wc.couldNotDecrypt"));
        } else {
          setBrowserShareError(t("wc.passkeyNoEncrypt"));
        }
      } else if (account.storedMode === "passphrase") {
        setShowBrowserPassphrase(true);
      }
    } catch (err) {
      setBrowserShareError(String(err));
    }
    setBrowserShareLoading(false);
  }


  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as KeyFileData;
        if (!data.id || !data.share || !data.publicKey) return;
        if (isEncryptedKeyFile(data)) {
          setPendingEncrypted(data);
          setKeyFile(null);
        } else {
          setKeyFile(data);
          setPendingEncrypted(null);
        }
      } catch {
        // ignore invalid files
      }
    };
    reader.readAsText(file);
  }

  // Policy pre-check
  const [policyCheck, setPolicyCheck] = useState<{
    allowed: boolean;
    reason?: string;
    blockedLeg?: string | null;
    fraudCheck?: { flagged: boolean; flags: string[]; level: string; address: string };
  } | null>(null);
  const [policyChecking, setPolicyChecking] = useState(false);

  // Transaction simulation
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  // ── Approve flow (passkey #2 for MPC signing) ──────────────────

  /** EVM calldata as it will be signed: the approve re-encoded with the edited cap, else unchanged. */
  function signedEvmData(data: string): string {
    return isApprove && approveOverride != null ? withEvmApproveAmount(data, approveOverride) : data;
  }

  /** The TRON transaction as it will be signed: a TRC-20 approve rewritten to the edited cap, else the dApp's. */
  function signedTronTx(): TronSignTransactionRequest["tx"] | null {
    const tx = tronParsed.req?.tx ?? null;
    if (!tx || approveOverride == null || tronDecoded?.kind !== "trc20_approve") return tx;
    return withTronApproveAmount(tx as unknown as TronTxJson, approveOverride) as unknown as TronSignTransactionRequest["tx"];
  }

  /** Approve button: key must already be loaded → pre-check policy → go to preview */
  async function handleApproveClick() {
    if (!account || !keyFile) return;

    // Policy pre-check for transactions (skip in recovery mode and for message signing)
    if (isTx && !isRecoveryMode()) {
      setPolicyChecking(true);
      setPolicyCheck(null);
      try {
        let to = "";
        let amount = "0";
        let nativeSymbol: string | undefined;
        let contractAddress: string | undefined;
        let reqChainId: number | undefined;
        let tronRawDataHex: string | undefined;

        if (isSolana && decodedSolTx) {
          to = decodedSolTx.to || "";
          amount = decodedSolTx.amount || "0";
          nativeSymbol = decodedSolTx.mint ? undefined : "SOL";
          contractAddress = decodedSolTx.mint || undefined;
        } else if (isTronTx && tronDecoded) {
          // rawDataHex lets the API read the very leg /sign/init will (a TRC-20 approve is an approval).
          to = tronDecoded.to;
          amount = tronDecoded.amount.toString();
          nativeSymbol = isTronNative ? "TRX" : undefined;
          contractAddress = tronTokenContract ?? undefined;
          tronRawDataHex = signedTronTx()!.raw_data_hex;
        } else if (txParams) {
          to = txParams.to || "";
          amount = txParams.value ? BigInt(txParams.value).toString() : "0";
          nativeSymbol = (!txParams.data || txParams.data === "0x") ? "ETH" : undefined;
          reqChainId = chainId || undefined;
        }

        if (to) {
          const res = await fetch(apiUrl(`/api/keys/${account.keyId}/rules/check`), {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
              to, amount, nativeSymbol, contractAddress, chainId: reqChainId,
              chainType: isSolana ? "solana" : isTronTx ? "tron" : "evm",
              from: account.address,
              ...(!isSolana && !isTronTx && txParams?.data ? { data: signedEvmData(txParams.data) } : {}),
              ...(tronRawDataHex ? { rawDataHex: tronRawDataHex } : {}),
            }),
          });
          if (res.ok) {
            setPolicyCheck(await res.json());
          }
        }
      } catch {
        // Fail-open
      }
      setPolicyChecking(false);
    }

    // EVM transaction simulation (non-blocking)
    if (!isSolana && !isTron && isTx && txParams && chain?.rpcUrl) {
      setSimResult(null);
      simulateEvmTransaction(chain.rpcUrl, {
        from: account.address,
        to: txParams.to || "",
        value: txParams.value || "0x0",
        data: txParams.data || "0x",
        gas: txParams.gas || txParams.gasLimit,
      }).then((r) => { if (r) setSimResult(r); });
    }

    setPhase("preview");
  }

  /** Passkey #2 completed → start signing */
  async function onPasskeyAuth(_result: PasskeyAuthResult) {
    setPhase("signing");
    setSigningStepIdx(0);

    try {
      if (!keyFile) {
        setError(t("wc.keyShareNotAvailable"));
        setPhase("error");
        return;
      }
      await executeSign(keyFile);
    } catch (err: unknown) {
      setError(friendlyError(err, t));
      setPhase("error");
    }
  }

  /** Browser passphrase submitted → decrypt key share */
  async function handleBrowserPassphraseSubmit(pw: string) {
    if (!account) return;
    try {
      const kf = await getKeyShareWithPassphrase(account.keyId, pw);
      if (!kf) {
        setBrowserShareError(t("wc.failedDecrypt"));
        return;
      }
      setKeyFile(kf);
      setShowBrowserPassphrase(false);
    } catch (err: any) {
      setBrowserShareError(err.message || String(err));
    }
  }

  async function executeSign(kf: KeyFileData) {
    try {
      const rpcUrl = chain?.rpcUrl;

      let result: unknown;
      switch (request.method) {
        case "personal_sign": {
          setSigningStepIdx(0); // Prepare
          const message = request.params[0];
          setSigningStepIdx(1); // MPC signing
          result = await wcPersonalSign(message, kf, account!.address);
          setSigningStepIdx(2); // Verify
          break;
        }
        case "eth_sign": {
          setSigningStepIdx(0);
          const hash = request.params[1];
          setSigningStepIdx(1);
          result = await wcEthSign(hash, kf, account!.address);
          setSigningStepIdx(2);
          break;
        }
        case "eth_signTypedData_v4": {
          setSigningStepIdx(0);
          const typedData = request.params[1];
          setSigningStepIdx(1);
          result = await wcSignTypedData(typedData, kf, account!.address);
          setSigningStepIdx(2);
          break;
        }
        case "eth_sendTransaction": {
          if (!rpcUrl) throw new Error("No RPC URL for chain " + chainId);
          // Override gas price and gas limit with user-selected values
          const txWithFee = { ...request.params[0] };
          if (gasPrice != null) {
            txWithFee.gasPrice = "0x" + gasPrice.toString(16);
          }
          txWithFee.gasLimit = "0x" + gasLimit.toString(16);
          // The spending cap the user set: the signed calldata carries it (the policy judges these bytes).
          if (txWithFee.data) txWithFee.data = signedEvmData(txWithFee.data);
          result = await wcSendTransaction(
            txWithFee, rpcUrl, chainId, kf, account!.address,
            (p) => setSigningStepIdx(txPhaseIndex[p]),
          );
          break;
        }
        case "solana_signTransaction": {
          const txBase64 = request.params?.transaction;
          if (!txBase64) throw new Error("Missing transaction data");
          const solResult = await wcSolanaSignTransaction(
            txBase64, kf, account!.address, chain?.rpcUrl ?? "",
            (p) => setSigningStepIdx(txPhaseIndex[p]),
          );
          result = solResult;
          break;
        }
        case "solana_signAndSendTransaction": {
          const txBase64ss = request.params?.transaction;
          if (!txBase64ss) throw new Error("Missing transaction data");
          const txSig = await wcSolanaSignAndSendTransaction(
            txBase64ss, kf, account!.address, chain?.rpcUrl ?? "",
            (p) => setSigningStepIdx(txPhaseIndex[p]),
          );
          result = { signature: txSig };
          break;
        }
        case "solana_signMessage": {
          setSigningStepIdx(0);
          const msgBase58 = request.params?.message;
          if (!msgBase58) throw new Error("Missing message data");
          if (!isSignableSolanaMessage(decodeSolanaMessageParam(msgBase58))) {
            throw new Error(t("wc.solanaMessageNotText"));
          }
          setSigningStepIdx(1);
          const msgResult = await wcSolanaSignMessage(msgBase58, kf, account!.address);
          setSigningStepIdx(2);
          result = { signature: msgResult.signature };
          break;
        }
        case "tron_signTransaction": {
          // WalletConnect TRON spec: answer with the signed transaction; the dApp broadcasts it.
          parseTronSignTransaction(request.params, account!.address); // re-check owner / txID before signing
          result = await wcTronSignTransaction(signedTronTx()!, kf, account!.address, (p) => setSigningStepIdx(txPhaseIndex[p]));
          break;
        }
        case "tron_signMessage": {
          // WalletConnect TRON spec: plain-text message, answer `{ signature }`.
          setSigningStepIdx(0);
          const tronMsg = parseTronSignMessage(request.params, account!.address);
          setSigningStepIdx(1);
          result = await wcTronSignMessage(tronMsg, kf, account!.address);
          setSigningStepIdx(2);
          break;
        }
        default:
          throw new Error("Unsupported method: " + request.method);
      }

      onApprove(result);

      if (isTronTx && typeof result === "object" && result !== null) {
        // TRON transaction — the dApp broadcasts it; poll its txID for confirmation
        const txId = (result as { txID: string }).txID;
        setSigningStepIdx(3);
        setTxResult({ txHash: txId, status: "pending" });

        if (account && chain) {
          const prefix = `cache:bal:${account.address}:${chain.id}:`;
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith(prefix)) localStorage.removeItem(k);
          }
          clearCache(tokenBalancesCacheKey(account.address, chain.id));
          notifyBalanceRefresh();
        }

        const rpcUrl = chain?.rpcUrl;
        if (rpcUrl) {
          try {
            const conf = await waitForTronConfirmation(rpcUrl, txId, () => {}, 30, 3000);
            setTxResult({ txHash: txId, status: conf.confirmed ? "success" : "pending", blockNumber: conf.blockNumber?.toString() });
          } catch {
            // Polling timed out
          }
        }
        setPhase("done");
      } else if (isTx && !isTronTx && typeof result === "string") {
        // EVM transaction — poll for receipt
        setSigningStepIdx(3);
        setTxResult({ txHash: result, status: "pending" });

        if (account && chain) {
          const prefix = `cache:bal:${account.address}:${chain.id}:`;
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith(prefix)) localStorage.removeItem(k);
          }
          clearCache(tokenBalancesCacheKey(account.address, chain.id));
          notifyBalanceRefresh();
        }

        const rpcUrl = chain?.rpcUrl;
        if (rpcUrl) {
          try {
            const receipt = await waitForReceipt(evmReceiptRpcUrls({ rpcUrl, evmChainId: chain?.evmChainId ?? null }), result, () => {}, 60, 3000);
            setTxResult({ txHash: result, status: receipt.status, blockNumber: receipt.blockNumber });
          } catch {
            // Polling timed out — show done as pending
          }
        }
        setPhase("done");
      } else if (isSolanaTx && typeof result === "object" && result !== null) {
        // Solana transaction — poll for confirmation (dApp broadcasts)
        const sig = (result as { signature: string }).signature;
        setSigningStepIdx(3);
        setTxResult({ txHash: sig, status: "pending" });

        if (account && chain) {
          const prefix = `cache:bal:${account.address}:${chain.id}:`;
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k?.startsWith(prefix)) localStorage.removeItem(k);
          }
          clearCache(tokenBalancesCacheKey(account.address, chain.id));
          notifyBalanceRefresh();
        }

        const rpcUrl = chain?.rpcUrl;
        if (rpcUrl) {
          try {
            const conf = await waitForSolanaConfirmation(rpcUrl, sig, () => {}, 60, 2000);
            setTxResult({ txHash: sig, status: conf.confirmed ? "success" : "pending", blockNumber: conf.slot?.toString() });
          } catch {
            // Polling timed out — show as success (dApp handled broadcast)
            setTxResult({ txHash: sig, status: "success" });
          }
        }
        setPhase("done");
      } else {
        // For signing methods, show done immediately
        setTxResult({ txHash: "", status: "success" });
        setPhase("done");
      }
    } catch (err: unknown) {
      setError(friendlyError(err, t));
      setPhase("error");
    }
  }

  // Format request for display (fallback when no review model applies)
  const requestDisplay = formatRequest(request, expert, permitToken);

  // Review models (UX spec: docs/ux/review-and-sign.md), from the same decoded bytes as signing.
  const dappMeta = wcService.getSessions().find((s) => s.topic === request.topic)?.peer.metadata;
  const reviewCtx: WcReviewContext = {
    from: { address: account?.address ?? "", name: account?.keyName },
    dappName: dappMeta?.name || "dApp",
    chainId: chainId || undefined,
    nativeSymbol: chainAssets.find((a) => a.isNative)?.symbol ?? (isSolana ? "SOL" : isTron ? "TRX" : "ETH"),
    tokenOf: (addr) => {
      const a = chainAssets.find((x) => x.contractAddress?.toLowerCase() === addr.toLowerCase());
      return a ? { symbol: a.symbol, decimals: a.decimals } : undefined;
    },
    prices,
    nameOf: (addr) => addressLabel(addr) ?? knownEvmContract(addr) ?? KNOWN_PROGRAMS[addr],
    isKnownRecipient: chain ? (addr) => isKnownRecipient(addr, chain.type) : undefined,
    feeWei: estimatedFeeWei,
    approveOverride,
    tokenBalanceRawOf: (addr) => {
      const b = tokenBalances.find((x) => x.asset.contractAddress?.toLowerCase() === addr.toLowerCase());
      return b ? BigInt(b.balance) : undefined;
    },
    tokenBalanceOf: (addr) => {
      const b = tokenBalances.find((x) => x.asset.contractAddress?.toLowerCase() === addr.toLowerCase());
      return b ? `${b.formatted} ${b.asset.symbol}` : undefined;
    },
    solana: decodedSolTx,
    tron: isTronTx ? { decoded: tronDecoded, feeSun: tronEstFeeSun, raw: tronParsed.req?.tx.raw_data_hex } : null,
  };
  const buildReview = (policy: WcReviewContext["policy"]): ReviewModel | null => {
    try {
      return buildWcRequestReview(request.method, request.params, { ...reviewCtx, policy });
    } catch {
      return null; // malformed params: the raw fallback below still shows everything
    }
  };
  const reviewModel = buildReview(null);
  const previewModel = phase === "preview" ? buildReview(policyCheck) : null;
  // Confirm stays off until the end of the review was on screen once (Rabby-style).
  // Re-armed when the signed bytes change (an edited cap): the new review must be seen to the end again.
  const gate = useScrollGate(`${request.topic}:${request.id}:${approveOverride ?? ""}`);
  // A Solana tx the decoder could not read is never signable (iOS fails closed the same way).
  const solanaUnreadable = isSolanaTx && !decodedSolTx;
  const previewBlocked = policyCheck?.allowed === false || !!previewModel?.warnings.some((w) => w.blocks) || solanaUnreadable;
  const reviewedAll = !previewModel || gate.seen;
  const capEditor = (m: ReviewModel) => m.allowance
    ? <AllowanceEditor allowance={m.allowance} dappName={reviewCtx.dappName} onChange={setApproveOverride} onInvalid={setCapInvalid} />
    : null;
  const reviewPolicy = isRecoveryMode() || !account ? undefined : () => {
    onReject();
    navigate("/accounts", { state: { openPolicyKeyId: account.keyId } });
  };


  // Signing progress steps
  const signLabel = isRecoveryMode() ? t("wc.localSigning") : expert ? t("wc.mpcSigning") : t("send.validatingAndSigning");
  const signLabelActive = progress.phase === "main"
    ? `${signLabel} ${progress.pct}%`
    : signLabel;
  const displaySteps = isTx
    ? [{ label: t("wc.buildTx") }, { label: signLabelActive }, { label: t("wc.broadcasting") }, { label: t("wc.confirming") }]
    : [{ label: t("wc.prepare") }, { label: signLabelActive }, { label: t("wc.verify") }];

  const txPhaseIndex: Record<WcSignPhase, number> = {
    "building-tx": 0,
    "mpc-signing": 1,
    "broadcasting": 2,
  };

  const canClose = phase === "review" || phase === "preview" || phase === "done" || phase === "error"
    || (phase === "signing" && signingStepIdx >= 2);

  // Signing/done/error phases render as a centered popup on all screens
  const isCompactPhase = phase === "signing" || phase === "done" || phase === "error";

  return (
    <div className={`fixed inset-0 z-50 ${isCompactPhase ? "flex items-center justify-center p-4 bg-black/50" : "bg-surface-secondary overflow-y-auto md:bg-transparent md:overflow-hidden md:flex md:items-center md:justify-center md:p-4"}`}>
      {!isCompactPhase && <div className="hidden md:block absolute inset-0 bg-black/50" onClick={canClose ? onReject : undefined} />}
      <div className={`relative bg-surface-secondary ${isCompactPhase ? "flex flex-col w-full max-w-md rounded-2xl overflow-hidden border border-border-primary shadow-xl max-h-[85vh]" : "min-h-full pb-[env(safe-area-inset-bottom)] md:min-h-0 md:pb-0 md:max-h-[85vh] md:w-full md:max-w-md md:overflow-y-auto md:rounded-2xl md:overflow-hidden md:border md:border-border-primary md:shadow-xl"}`}>
        {/* Header — sticky so close button is always reachable */}
        <div className={`flex items-center justify-between px-5 py-4 border-b border-border-secondary shrink-0 sticky top-0 bg-surface-secondary z-10 ${!isCompactPhase ? "pt-[calc(1rem+env(safe-area-inset-top))] md:pt-4" : ""}`}>
          {phase === "review" || phase === "preview" ? (
            <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
              {phase === "preview" && (
                <button
                  onClick={() => setPhase("review")}
                  aria-label={t("common.edit")}
                  className="p-1 -ml-1 rounded-md text-text-tertiary hover:text-text-primary transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <DappTitle name={dappMeta?.name || "dApp"} url={dappMeta?.url} iconUrl={dappMeta?.icons?.[0]} />
              {chain && <span className="ml-auto"><NetworkChip name={chain.displayName} iconUrl={chain.iconUrl} /></span>}
            </div>
          ) : (
            <h3 className="text-sm font-semibold text-text-primary">
              {phase === "signing"
                ? <><Clock className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("wc.signing")}</>
                : phase === "done"
                  ? (txResult?.status === "success" ? <><CircleCheck className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("wc.success")}</> : txResult?.status === "pending" ? <><Radio className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("wc.broadcast")}</> : <><CircleX className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("wc.failed")}</>)
                  : null}
            </h3>
          )}
          {canClose && (
            <button
              onClick={phase === "done" ? (onDismiss ?? onReject) : onReject}
              className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* ── Review phase ────────────────────────────────────── */}
          {phase === "review" && (
            <>
              {/* Key share section — top, consistent with transfer form */}
              {account && (
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">{t("wc.keyShare")}</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  {keyFile ? (
                    <div className="bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
                        <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text-secondary truncate">
                          {keyFile.id.slice(0, 8)}...{keyFile.id.slice(-4)}
                        </p>
                        <p className="text-[10px] text-text-muted font-mono truncate">{keyFile.publicKey.slice(0, 24)}...</p>
                      </div>
                      <button
                        onClick={() => !isRecoveryMode() && setKeyFile(null)}
                        disabled={isRecoveryMode()}
                        className={`p-1 rounded-md transition-colors ${isRecoveryMode() ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-tertiary"}`}
                        title={isRecoveryMode() ? t("wc.keyLoaded") : t("wc.changeKey")}
                      >
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </button>
                    </div>
                  ) : account.hasStored && !showBrowserPassphrase ? (
                    <div className="space-y-2">
                      <button
                        onClick={loadBrowserShare}
                        disabled={browserShareLoading}
                        className="w-full bg-surface-primary border border-blue-500/30 rounded-lg px-3 py-2.5 flex items-center gap-2.5 hover:border-blue-500/50 transition-colors text-left disabled:opacity-50 animate-pulse"
                      >
                        <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a9 9 0 11-18 0V5.25" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-text-secondary truncate">{account.keyId.slice(0, 8)}...</p>
                          <p className="text-[10px] text-text-muted">{account.storedMode === "prf" ? t("wc.passkeyEncrypted") : t("wc.passphraseEncrypted")} · ECDSA + EdDSA</p>
                        </div>
                        {browserShareLoading ? (
                          <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                        ) : (
                          <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                        )}
                      </button>
                      {browserShareError && (
                        <p className="text-[11px] text-red-400 text-center">{browserShareError}</p>
                      )}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full text-[11px] text-text-muted hover:text-text-tertiary transition-colors"
                      >
                        {t("wc.orUploadFile")}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full bg-surface-primary border border-border-primary border-dashed rounded-lg px-3 py-3 flex items-center justify-center gap-2 hover:border-blue-500/50 transition-colors text-left"
                      >
                        <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                        <span className="text-xs text-text-muted">{t("wc.uploadKeyShare")}</span>
                      </button>
                      <p className="text-[10px] text-text-muted text-center">
                        {t("wc.restoreFromBackup")}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Passphrase prompt for encrypted file upload */}
              {pendingEncrypted && !keyFile && (
                <div className="bg-surface-primary border border-border-primary rounded-lg p-3">
                  <p className="text-xs text-text-muted mb-2">
                    <span className="font-mono text-text-tertiary">{pendingEncrypted.id.slice(0, 8)}...</span> — {t("wc.enterPassphrase")}
                  </p>
                  <PassphraseInput
                    mode="enter"
                    submitLabel={t("wc.decrypt")}
                    onSubmit={async (pw) => {
                      const decrypted = await decryptKeyFile(pendingEncrypted, pw);
                      setKeyFile(decrypted);
                      setPendingEncrypted(null);
                    }}
                  />
                </div>
              )}

              {/* Browser-stored share passphrase prompt */}
              {showBrowserPassphrase && !keyFile && (
                <div className="bg-surface-primary border border-border-primary rounded-lg p-3">
                  <p className="text-xs text-text-muted mb-2">
                    {t("wc.enterPassphraseKey")}
                  </p>
                  <PassphraseInput
                    mode="enter"
                    submitLabel={t("wc.decrypt")}
                    onSubmit={handleBrowserPassphraseSubmit}
                  />
                  {browserShareError && (
                    <p className="text-[11px] text-red-400 mt-2">{browserShareError}</p>
                  )}
                </div>
              )}

              {reviewModel ? (
                <ReviewBody model={reviewModel} copyable expert={expert} heroAccessory={capEditor(reviewModel)}>
                  {isTx && !isSolana && !isTron && (
                    <>
                  {/* Fee level selector — expert only, non-expert uses default "medium" */}
                  {expert && <div className="bg-surface-primary border border-border-primary rounded-lg p-1.5">
                    <div className="grid grid-cols-3 gap-1">
                      {(["low", "medium", "high"] as FeeLevel[]).map((level) => {
                        const isActive = feeLevel === level;
                        const gp = baseGasPrice != null
                          ? BigInt(Math.round(Number(baseGasPrice) * FEE_MULTIPLIER[level]))
                          : null;
                        const feeText = gp != null ? `${formatGwei(gp)} Gwei` : "...";
                        return (
                          <button
                            key={level}
                            onClick={() => setFeeLevel(level)}
                            className={`flex flex-col items-center py-2 px-1 rounded-md transition-all ${
                              isActive
                                ? "bg-surface-tertiary ring-1 ring-blue-500/40"
                                : "hover:bg-surface-tertiary/50"
                            }`}
                          >
                            <span className={`text-[11px] font-medium ${isActive ? "text-text-primary" : "text-text-muted"}`}>
                              {t(FEE_LABEL_KEYS[level])}
                            </span>
                            <span className={`text-[10px] tabular-nums mt-0.5 ${isActive ? "text-text-secondary" : "text-text-muted/70"}`}>
                              {feeText}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>}

                  {/* Expert: advanced tx overrides */}
                  {expert && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">{t("common.advanced")}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-text-muted mb-1">{t("wc.nonce")}</label>
                          <input
                            value=""
                            readOnly
                            placeholder={currentNonce != null ? currentNonce.toString() : "..."}
                            className="w-full bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5 text-xs text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">{t("wc.gasLimit")}</label>
                          <input
                            value={gasLimitInput}
                            onChange={(e) => setGasLimitInput(e.target.value.replace(/[^0-9]/g, ""))}
                            placeholder={defaultGasLimit.toString()}
                            className="w-full bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5 text-xs text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">{t("wc.maxFee")}</label>
                          <input
                            value={maxFeeOverride}
                            onChange={(e) => setMaxFeeOverride(e.target.value)}
                            placeholder={gasPrice != null ? formatGwei(gasPrice) : "..."}
                            className="w-full bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5 text-xs text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">{t("wc.priorityFee")}</label>
                          <input
                            value={priorityFeeOverride}
                            onChange={(e) => setPriorityFeeOverride(e.target.value)}
                            placeholder={baseGasPrice != null ? formatGwei(baseGasPrice / 10n) : "..."}
                            className="w-full bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5 text-xs text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors"
                          />
                        </div>
                      </div>

                      <ExpertWarnings
                        gasLimitOverride={gasLimitInput}
                        maxFeeOverride={maxFeeOverride}
                        estimatedGas={estimatedGasLimit}
                        baseGasPrice={baseGasPrice}
                        lowMultiplier={FEE_MULTIPLIER.low}
                      />
                    </div>
                  )}
                    </>
                  )}
                  {isTronTx && (
                    <>
                  {/* Expert: TRON details */}
                  {expert && (
                    <div className="space-y-2">
                      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">{t("common.advanced")}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5">
                          <p className="text-[10px] text-text-muted mb-0.5">Bandwidth</p>
                          <p className="text-xs text-text-primary font-mono tabular-nums">
                            {tronResources ? tronResources.bandwidthFree.toLocaleString() : "..."}
                          </p>
                        </div>
                        <div className="bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5">
                          <p className="text-[10px] text-text-muted mb-0.5">Energy</p>
                          <p className="text-xs text-text-primary font-mono tabular-nums">
                            {tronResources ? tronResources.energyFree.toLocaleString() : "..."}
                          </p>
                        </div>
                      </div>
                      {tronFeeLimitSun != null && (
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Fee limit</label>
                          <div className="bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5">
                            <p className="text-xs text-text-primary font-mono tabular-nums">{formatSun(tronFeeLimitSun)} TRX</p>
                          </div>
                        </div>
                      )}
                      {tronParsed.req && (
                        <div>
                          <p className="text-[10px] text-text-muted mb-0.5">Tx ID</p>
                          <p className="text-[9px] font-mono text-text-muted break-all">{tronParsed.req.tx.txID}</p>
                        </div>
                      )}
                    </div>
                  )}
                    </>
                  )}
                </ReviewBody>
              ) : (
                <>
                  {requestDisplay.map(({ label, value }, i) => {
                    const isJson = value.trimStart().startsWith("{") || value.trimStart().startsWith("[");
                    return (
                      <div key={i}>
                        <label className="block text-xs text-text-muted mb-1.5">{label}</label>
                        <div className="bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 overflow-auto max-h-60">
                          {isJson ? (
                            <pre
                              className="text-xs font-mono break-all whitespace-pre-wrap leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: Prism.highlight(value, Prism.languages.json, "json") }}
                            />
                          ) : (
                            <p className="text-xs text-text-tertiary font-mono break-all whitespace-pre-wrap">{value}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* ── Preview phase (review before signing) ─────────────── */}
          {phase === "preview" && (
            previewModel ? (
              <ReviewBody model={previewModel} copyable expert={expert} onReviewPolicy={reviewPolicy} onSeenEnd={gate.onSeenEnd} heroAccessory={capEditor(previewModel)}>
                {isTronTx ? (
                  <>
                  {/* Balance preview */}
                  {nativeBalance != null && (() => {
                    const changes: BalanceChange[] = [{
                      symbol: "TRX",
                      decimals: 6,
                      currentBalance: nativeBalance,
                      delta: -(tronAmountSun + tronEstFeeSun),
                    }];
                    // For TRC-20 transfers, also show token balance change
                    if (isTrc20Transfer) {
                      const rawAmount = tronTokenAmount;
                      const tokenSymbol = tronTokenInfo?.symbol || "tokens";
                      const tokenDecimals = tronTokenInfo?.decimals ?? 6;
                      const contractAddr = tronTokenContract;
                      const tokenBal = tokenBalances.find(
                        (b) => b.asset.contractAddress?.toLowerCase() === contractAddr?.toLowerCase()
                      );
                      changes.push({
                        symbol: tokenSymbol,
                        decimals: tokenDecimals,
                        currentBalance: tokenBal?.balance || "0",
                        delta: -rawAmount,
                      });
                    }
                    return <BalancePreview changes={changes} prices={prices} />;
                  })()}
                  </>
                ) : isTx && !isSolana ? (
                  <>
                  {/* Balance preview — simulation or static fallback */}
                  {simResult && simResult.changes.length > 0 ? (
                    <SimulationPreview simResult={simResult} prices={prices} />
                  ) : nativeBalance != null ? (
                    (() => {
                      const txValue = txParams?.value ? BigInt(txParams.value) : 0n;
                      const feeCost = estimatedFeeWei ?? 0n;
                      const changes: BalanceChange[] = [];

                      changes.push({
                        symbol: "ETH",
                        decimals: 18,
                        currentBalance: nativeBalance,
                        delta: -(txValue + feeCost),
                      });

                      if (isApprove && approveToken && txParams?.to) {
                        const tokenBal = tokenBalances.find(
                          (b) => b.asset.contractAddress?.toLowerCase() === txParams.to.toLowerCase()
                        );
                        if (tokenBal) {
                          changes.push({
                            symbol: approveToken.symbol,
                            decimals: approveToken.decimals,
                            currentBalance: tokenBal.balance,
                            delta: 0n,
                          });
                        }
                      }

                      return <BalancePreview changes={changes} prices={prices} />;
                    })()
                  ) : null}
                  </>
                ) : isSolanaTx && decodedSolTx ? (
                  <>
                  {/* Balance preview */}
                  {nativeBalance != null && (
                    (() => {
                      const fee = BigInt(decodedSolTx.fee.costLamports);
                      const changes: BalanceChange[] = [];

                      if (decodedSolTx.type === "sol_transfer" && decodedSolTx.amount) {
                        // SOL transfers (all of them): deduct amount + fee
                        changes.push({
                          symbol: "SOL",
                          decimals: 9,
                          currentBalance: nativeBalance,
                          delta: -(solanaSolOutflow(decodedSolTx.instructions) + fee),
                        });
                      } else if (decodedSolTx.type === "spl_transfer" && decodedSolTx.amount) {
                        // SPL transfer: SOL fee + token amount
                        changes.push({
                          symbol: "SOL",
                          decimals: 9,
                          currentBalance: nativeBalance,
                          delta: -(solanaSolOutflow(decodedSolTx.instructions) + fee),
                        });
                        const tokenSymbol = solTokenInfo?.symbol || "tokens";
                        const tokenDecimals = decodedSolTx.decimals ?? solTokenInfo?.decimals ?? 0;
                        const tokenBal = tokenBalances.find(
                          (b) => b.asset.contractAddress?.toLowerCase() === decodedSolTx.mint?.toLowerCase()
                        );
                        changes.push({
                          symbol: tokenSymbol,
                          decimals: tokenDecimals,
                          currentBalance: tokenBal?.balance || "0",
                          delta: -BigInt(decodedSolTx.amount),
                        });
                      } else {
                        // contract_call: only fee is known
                        changes.push({
                          symbol: "SOL",
                          decimals: 9,
                          currentBalance: nativeBalance,
                          delta: -(solanaSolOutflow(decodedSolTx.instructions) + fee),
                        });
                      }

                      return <BalancePreview changes={changes} prices={prices} />;
                    })()
                  )}
                  </>
                ) : null}
              </ReviewBody>
            ) : (
              <div className="space-y-5">
                <PolicyWarning policyCheck={policyCheck} />
                  {/* Request details */}
                  {requestDisplay.map(({ label, value }, i) => {
                    const isJson = value.trimStart().startsWith("{") || value.trimStart().startsWith("[");
                    return (
                      <div key={i} className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
                        <div className="px-3 py-2.5">
                          <span className="text-xs text-text-muted">{label}</span>
                          {isJson ? (
                            <pre
                              className="text-xs font-mono break-all whitespace-pre-wrap mt-1 max-h-60 overflow-auto leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: Prism.highlight(value, Prism.languages.json, "json") }}
                            />
                          ) : (
                            <p className="text-xs text-text-primary font-mono break-all whitespace-pre-wrap mt-1 max-h-60 overflow-auto">{value}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )
          )}

          {/* ── Signing phase ────────────────────────────────────── */}
          {phase === "signing" && (
            <div className="py-6">
              {/* Phase label */}
              <p className="text-sm font-medium text-text-primary text-center mb-2">
                {displaySteps[signingStepIdx]?.label ?? t("wc.signing")}
              </p>

              {/* Progress bar */}
              <div className="mb-5">
                <ProgressBar {...progress} minimal={!expert} />
              </div>

              {/* Progress steps — expert only */}
              {expert && <SigningStepper steps={displaySteps} currentIndex={signingStepIdx} className="mt-4" />}

              {/* Tx hash card (visible during Confirming step) */}
              {txResult?.txHash && chain && signingStepIdx >= 3 && (
                <a
                  href={explorerLink(chain.explorerUrl, `/tx/${txResult.txHash}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between mt-5 mx-auto max-w-[260px] px-3 py-2.5 rounded-lg bg-surface-primary/60 border border-border-secondary hover:border-blue-500/30 transition-colors group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-text-muted shrink-0">Tx</span>
                    <span className="text-xs font-mono text-text-secondary truncate">{txResult.txHash}</span>
                  </div>
                  <svg className="w-3.5 h-3.5 text-text-muted group-hover:text-blue-400 shrink-0 ml-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </div>
          )}

          {/* ── Done phase ───────────────────────────────────────── */}
          {phase === "done" && txResult && (
            <div className="text-center py-6">
              {txResult.status === "success" ? (
                <>
                  <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-text-primary mb-1">
                    {isTx ? t("wc.txConfirmedLabel") : t("wc.signed")}
                  </p>
                  {isTx && !isSolana && !isTron && txParams?.value && (
                    <p className="text-sm text-text-muted tabular-nums">
                      {formatWei(BigInt(txParams.value))} {chain?.type === "evm" ? (chain.name?.includes("BASE") ? "ETH" : "ETH") : ""}
                    </p>
                  )}
                  {isTronNative && (
                    <p className="text-sm text-text-muted tabular-nums">
                      {formatSun(tronAmountSun)} TRX
                    </p>
                  )}
                  {isSolanaTx && decodedSolTx?.amount && (decodedSolTx.type === "sol_transfer" || decodedSolTx.type === "spl_transfer") && (
                    <p className="text-sm text-text-muted tabular-nums">
                      {decodedSolTx.type === "sol_transfer"
                        ? `${formatLamports(BigInt(decodedSolTx.amount))} SOL`
                        : `${decodedSolTx.formattedAmount || decodedSolTx.amount} ${solTokenInfo?.symbol || "tokens"}`}
                    </p>
                  )}
                </>
              ) : txResult.status === "pending" ? (
                <>
                  <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-text-primary mb-1">{t("wc.txBroadcastLabel")}</p>
                  {txParams?.value && (
                    <p className="text-sm text-text-muted tabular-nums mb-1">
                      {formatWei(BigInt(txParams.value))} ETH
                    </p>
                  )}
                  <p className="text-[11px] text-text-muted">{receiptGaveUp ? t("wc.couldNotConfirm") : t("wc.waitingConfirmation")}</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <p className="text-lg font-semibold text-text-primary mb-1">{t("wc.txFailed")}</p>
                  <p className="text-sm text-text-muted">{t("wc.txReverted")}</p>
                </>
              )}

              {/* Transaction details card */}
              {txResult.txHash && chain && (
                <div className="mt-5 mx-auto max-w-[280px] rounded-lg bg-surface-primary/60 border border-border-secondary overflow-hidden">
                  <a
                    href={explorerLink(chain.explorerUrl, `/tx/${txResult.txHash}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-surface-tertiary/50 transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] text-text-muted shrink-0">Tx</span>
                      <span className="text-xs font-mono text-text-secondary truncate">{txResult.txHash}</span>
                    </div>
                    <svg className="w-3.5 h-3.5 text-text-muted group-hover:text-blue-400 shrink-0 ml-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  {txResult.blockNumber && (
                    <div className="flex items-center px-3 py-2 border-t border-border-secondary">
                      <span className="text-[11px] text-text-muted shrink-0">{isSolana ? t("wc.slot") : t("wc.block")}</span>
                      <span className="text-xs font-mono text-text-secondary tabular-nums ml-2">
                        {(isSolana || isTron ? Number(txResult.blockNumber) : parseInt(txResult.blockNumber, 16)).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Done footer ────────────────────────────────────────── */}
          {phase === "done" && (
            <div className="px-5 pb-5">
              <button
                onClick={() => {
                  // Navigate to account detail with pending tx info
                  if (account && chain && isTx && txResult?.txHash) {
                    fetchAssets(chain.id).then((chainAssets) => {
                      const native = chainAssets.find((a: Asset) => a.isNative);
                      if (native) {
                        const tx = request.params[0];
                        const value = tx.value ? formatWei(BigInt(tx.value)) : "0";
                        navigate(
                          `/accounts/${account.keyId}/${chain.name.toLowerCase()}/${native.symbol}`,
                          { state: { pendingTx: { hash: txResult.txHash, from: account.address, to: tx.to || "", value, symbol: native.symbol, timestamp: Math.floor(Date.now() / 1000) } } },
                        );
                      }
                    });
                  }
                  (onDismiss ?? onReject)(); // remove from queue without re-rejecting
                }}
                className="w-full bg-surface-tertiary hover:bg-border-primary text-text-secondary text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                {t("wc.done")}
              </button>
            </div>
          )}

          {/* ── Error phase ──────────────────────────────────────── */}
          {phase === "error" && (
            <SigningError
              error={error}
              title={isTx ? t("wc.txFailed") : t("wc.signingFailed")}
              onClose={onReject}
              onRetry={() => { setError(""); setPhase("review"); }}
            />
          )}
        </div>

        {/* Footer — review phase (safe-area bottom for PWA) */}
        {phase === "review" && (
          <div className="px-5 py-4 border-t border-border-secondary shrink-0 sticky bottom-0 bg-surface-secondary pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
            <button
              onClick={handleApproveClick}
              disabled={!account || !keyFile || policyChecking || !!tronParsed.error || capInvalid || solanaUnreadable}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {policyChecking ? t("wc.checking") : <><Eye className="w-4 h-4 inline-block align-[-2px] mr-1" />{t("wc.reviewTx")}</>}
            </button>
          </div>
        )}

        {/* Footer — preview phase */}
        {phase === "preview" && (
          <div className="px-5 py-4 border-t border-border-secondary shrink-0 sticky bottom-0 bg-surface-secondary flex gap-2 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
            <button
              onClick={onReject}
              className="flex-1 border border-border-primary text-text-secondary hover:text-text-primary text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {t("wc.reject")}
            </button>
            <button
              disabled={previewBlocked || !reviewedAll || capInvalid}
              onClick={() => onPasskeyAuth({} as PasskeyAuthResult)}
              className="flex-[2] bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {previewBlocked ? t("wc.blockedByPolicy") : !reviewedAll ? t("review.scrollToReview") : t("wc.confirmSign")}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatRequest(request: PendingRequest, expertMode = false, permitTokenInfo?: { symbol: string; decimals: number } | null): Array<{ label: string; value: string }> {
  switch (request.method) {
    case "personal_sign": {
      const msgHex = request.params[0];
      let decoded: string;
      try {
        const bytes = hexToUint8(msgHex);
        decoded = new TextDecoder().decode(bytes);
      } catch {
        decoded = msgHex;
      }
      return [{ label: "Message", value: decoded }];
    }
    case "eth_sign":
      return [{ label: "Hash", value: request.params[1] }];
    case "eth_signTypedData_v4": {
      const parsed = typeof request.params[1] === "string"
        ? JSON.parse(request.params[1])
        : request.params[1];
      const items: Array<{ label: string; value: string }> = [];
      if (parsed.domain?.name) items.push({ label: "Domain", value: parsed.domain.name });
      if (parsed.domain?.verifyingContract) items.push({ label: "Contract", value: parsed.domain.verifyingContract });
      if (parsed.primaryType) items.push({ label: "Type", value: parsed.primaryType });

      // Parse known message types into human-readable fields
      const msg = parsed.message;
      if (parsed.primaryType === "Permit" && msg) {
        // ERC-20 Permit (EIP-2612)
        if (msg.spender) items.push({ label: "Spender", value: msg.spender });
        if (msg.value != null) {
          const val = BigInt(msg.value);
          const isUnlimited = val >= BigInt("0xffffffffffffffffffffffffffffffff");
          const decimals = permitTokenInfo?.decimals ?? 18;
          const symbol = permitTokenInfo?.symbol ?? "";
          const formatted = isUnlimited ? "Unlimited" : formatTokenAmount(val, decimals);
          items.push({ label: `Approval Amount${symbol ? ` (${symbol})` : ""}`, value: formatted });
        }
        if (msg.deadline != null) {
          const ts = Number(msg.deadline);
          const date = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
          items.push({ label: "Deadline", value: date.toLocaleString() });
        }
      } else if (parsed.primaryType === "PermitSingle" && msg?.details) {
        // Permit2 PermitSingle (Uniswap)
        const d = msg.details;
        if (d.token) items.push({ label: "Token", value: d.token });
        if (msg.spender) items.push({ label: "Spender", value: msg.spender });
        if (d.amount != null) {
          const val = BigInt(d.amount);
          const isUnlimited = val >= BigInt("0xffffffffffffffffffffffffffffffff");
          const decimals = permitTokenInfo?.decimals ?? 18;
          const symbol = permitTokenInfo?.symbol ?? "";
          const formatted = isUnlimited ? "Unlimited" : formatTokenAmount(val, decimals);
          items.push({ label: `Approval Amount${symbol ? ` (${symbol})` : ""}`, value: formatted });
        }
        if (d.expiration != null) {
          const ts = Number(d.expiration);
          const date = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
          items.push({ label: "Expiration", value: date.toLocaleString() });
        }
      } else if (parsed.primaryType === "PermitBatch" && msg?.details) {
        // Permit2 PermitBatch
        if (msg.spender) items.push({ label: "Spender", value: msg.spender });
        items.push({ label: "Tokens", value: `${msg.details.length} token${msg.details.length > 1 ? "s" : ""}` });
      } else {
        // Unknown type — always show raw message
        items.push({ label: "Message", value: JSON.stringify(msg, null, 2) });
      }

      // Expert: show raw message for all typed data
      if (expertMode) {
        items.push({ label: "Raw Message", value: JSON.stringify(msg, null, 2) });
      }

      return items;
    }
    case "eth_sendTransaction": {
      const tx = request.params[0];
      const items: Array<{ label: string; value: string }> = [];
      if (tx.to) items.push({ label: "To", value: tx.to });
      if (tx.value) {
        const wei = BigInt(tx.value);
        const ethStr = formatWei(wei);
        items.push({ label: "Value", value: `${ethStr} ETH` });
      }
      if (tx.data && tx.data !== "0x") {
        const dataDisplay = expertMode ? tx.data : (tx.data.length > 66 ? tx.data.slice(0, 66) + "..." : tx.data);
        items.push({ label: "Data", value: dataDisplay });
      }
      if (tx.gas || tx.gasLimit) items.push({ label: "Gas Limit", value: String(parseInt(tx.gas || tx.gasLimit, 16)) });
      return items;
    }
    case "solana_signTransaction":
    case "solana_signAndSendTransaction": {
      const items: Array<{ label: string; value: string }> = [];
      items.push({ label: "Transaction", value: request.params?.transaction?.slice(0, 60) + "..." });
      return items;
    }
    case "solana_signMessage": {
      const items: Array<{ label: string; value: string }> = [];
      try {
        const msgText = new TextDecoder().decode(decodeSolanaMessageParam(request.params?.message || ""));
        items.push({ label: "Message", value: msgText });
      } catch {
        items.push({ label: "Message (base58)", value: request.params?.message || "" });
      }
      return items;
    }
    case "tron_signTransaction": {
      // Read from the signed bytes (raw_data_hex), never the dApp's JSON raw_data.
      try {
        const { tx, decoded } = parseTronSignTransaction(request.params, request.params?.account ?? "");
        const items: Array<{ label: string; value: string }> = [{ label: "Tx ID", value: tx.txID }, { label: "Type", value: decoded.kind }];
        if (decoded.contractAddress) items.push({ label: "Token", value: decoded.contractAddress });
        items.push({ label: decoded.kind === "trc20_approve" ? "Spender" : "To", value: decoded.to });
        const amount = decoded.kind === "trx_transfer" ? `${formatSun(decoded.amount)} TRX` : decoded.unlimited ? "Unlimited" : decoded.amount.toString();
        items.push({ label: "Amount", value: amount });
        return items;
      } catch (e) {
        return [{ label: "Error", value: e instanceof Error ? e.message : String(e) }];
      }
    }
    case "tron_signMessage": {
      // WalletConnect TRON spec: the message is plain text.
      return [{ label: "Message", value: typeof request.params?.message === "string" ? request.params.message : "" }];
    }
    default:
      return [{ label: "Method", value: request.method }, { label: "Params", value: JSON.stringify(request.params) }];
  }
}

function hexToUint8(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function formatWei(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth === 0) return "0";
  return eth < 0.0001 ? eth.toExponential(2) : eth.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
