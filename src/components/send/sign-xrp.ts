import { hexToBytes, bytesToHex } from "../../shared/utils";
import { performMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../../lib/mpc";
import { authHeaders } from "../../lib/auth";
import { apiUrl } from "../../lib/apiBase";
import { sensitiveHeadersFor } from "../../lib/passkey";
import { parseDerSignature } from "../../lib/chains/evmTx";
import { getCompressedPublicKey } from "../../lib/chains/btcTx";
import {
  getAccountInfo as getXrpAccountInfo,
  getCurrentLedgerIndex,
  hashForSigning as xrpHashForSigning,
  assembleSignedTx as xrpAssembleSignedTx,
  encodeXrpSignature,
  broadcastXrpTransaction,
  waitForXrpConfirmation,
  XRP_BASE_FEE,
  type XrpPaymentParams,
} from "../../lib/chains/xrpTx";
import type { SigningContext } from "./signing-flows";
import { mapSendError } from "./send-error";

export async function executeXrpSigningFlow(ctx: SigningContext): Promise<void> {
  const {
    keyFile, chain, address, to, amount,
    destinationTag, confirmBeforeBroadcast,
    onTxSubmitted, onTxConfirmed,
    setStep, setSigningPhase, setSignatureCount, setSigningError,
    setSignedRawTx, setTxResult, setPendingTxHash, setKeyFile,
    t,
  } = ctx;

  if (!chain.rpcUrl) return;

  setStep("signing");
  setSigningPhase("building-tx");
  setSignatureCount(1);
  setSigningError(null);

  try {
    // Restore key handles if not in memory
    if (!clientKeys.has(keyFile.id)) {
      await restoreKeyHandles(keyFile.id, keyFile.share, keyFile.eddsaShare);
    }

    // 1. Build payment params
    const acctInfo = await getXrpAccountInfo(chain.rpcUrl, address);
    const ledgerIndex = await getCurrentLedgerIndex(chain.rpcUrl);
    const amountDrops = BigInt(Math.round(parseFloat(amount.replace(/,/g, "")) * 1e6));

    const pubKeyRaw = hexToBytes(keyFile.publicKey);
    const compressed = getCompressedPublicKey(
      Array.from(pubKeyRaw).map((b) => b.toString(16).padStart(2, "0")).join("")
    );

    const params: XrpPaymentParams = {
      from: address,
      to,
      amountDrops,
      fee: XRP_BASE_FEE,
      sequence: acctInfo.sequence,
      lastLedgerSequence: ledgerIndex + 20,
      destinationTag: destinationTag ? Number(destinationTag) : undefined,
      signingPubKey: compressed,
    };

    // 2. MPC signing
    setSigningPhase("mpc-signing");

    const sighash = xrpHashForSigning(params);

    const { signature: sigRaw, sessionId } = await performMpcSign({
      algorithm: "ecdsa",
      keyId: keyFile.id,
      hash: sighash,
      initPayload: {
        id: keyFile.id,
        chainType: "xrp",
        xrpTx: {
          from: address,
          to,
          amountDrops: amountDrops.toString(),
          fee: XRP_BASE_FEE.toString(),
          sequence: params.sequence,
          lastLedgerSequence: params.lastLedgerSequence,
          destinationTag: params.destinationTag,
          signingPubKey: bytesToHex(compressed),
        },
        from: address,
      },
      headers: await sensitiveHeadersFor(keyFile.id),
    });

    // 3. Parse DER signature (low-S normalized) and re-encode as minimal DER for XRP
    const { r, s } = parseDerSignature(sigRaw);
    const sigDer = encodeXrpSignature(r, s);
    const signedTxHex = xrpAssembleSignedTx(params, sigDer);

    if (confirmBeforeBroadcast) {
      setSignedRawTx(signedTxHex);
      setTxResult({ status: "success", txHash: "sign-only" });
      setKeyFile(null);
      setStep("result");
      return;
    }

    // 4. Broadcast
    setSigningPhase("broadcasting");
    const txHash = await broadcastXrpTransaction(chain.rpcUrl, signedTxHex);

    fetch(apiUrl("/api/sign/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ keyShareId: keyFile.id, sessionId, txHash, chainId: chain.id }),
    }).catch(() => {});

    onTxSubmitted?.(txHash, to, amount);

    // 5. Wait for confirmation
    setPendingTxHash(txHash);
    setSigningPhase("polling");
    const result = await waitForXrpConfirmation(chain.rpcUrl, txHash, () => {}, 30, 3000);

    setTxResult({
      status: result.confirmed ? "success" : "pending",
      txHash,
      blockNumber: result.ledgerIndex,
    });
    if (result.confirmed) onTxConfirmed?.(txHash);
    setKeyFile(null);
    setStep("result");

  } catch (err: unknown) {
    console.error("[send] XRP Error:", err);
    setSigningError(mapSendError(err, t));
  } finally {
    clearClientKey(keyFile.id);
  }
}
