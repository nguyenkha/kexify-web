import { performMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../../lib/mpc";
import { authHeaders } from "../../lib/auth";
import { apiUrl } from "../../lib/apiBase";
import { sensitiveHeaders } from "../../lib/passkey";
import {
  buildAlgoPaymentTx,
  buildAlgoAssetTransferTx,
  assembleAlgoSignedTx,
  broadcastAlgoTransaction,
  waitForAlgoConfirmation,
  getAlgoSuggestedParams,
  algoAddressToPublicKey,
  eddsaPubKeyToAlgoAddress,
  toBase64,
} from "../../lib/chains/algoTx";
import type { SigningContext } from "./signing-flows";
import { friendlyError } from "./signing-flows";

export async function executeAlgoSigningFlow(ctx: SigningContext): Promise<void> {
  const {
    keyFile, chain, asset, to, amount,
    confirmBeforeBroadcast,
    onTxSubmitted, onTxConfirmed,
    setStep, setSigningPhase, setSignatureCount, setSigningError,
    setSignedRawTx, setTxResult, setPendingTxHash, setKeyFile, setPendingEncrypted,
    t,
  } = ctx;

  if (!chain.rpcUrl) return;

  setStep("signing");
  setSigningPhase("building-tx");
  setSignatureCount(1);
  setSigningError(null);

  try {
    if (!clientKeys.has(keyFile.id)) {
      await restoreKeyHandles(keyFile.id, keyFile.share, keyFile.eddsaShare);
    }

    // 1. Derive address and fetch params
    const fromAddress = eddsaPubKeyToAlgoAddress(keyFile.eddsaPublicKey);
    const fromPubKey = algoAddressToPublicKey(fromAddress);
    const toPubKey = algoAddressToPublicKey(to);
    const params = await getAlgoSuggestedParams(chain.rpcUrl);

    // 2. Build transaction
    let txBytes: Uint8Array;
    if (asset.isNative) {
      const amountMicro = BigInt(Math.round(parseFloat(amount) * 1e6));
      txBytes = buildAlgoPaymentTx(fromPubKey, toPubKey, amountMicro, params);
    } else {
      const assetId = parseInt(asset.contractAddress ?? "", 10);
      const amountRaw = BigInt(Math.round(parseFloat(amount) * (10 ** asset.decimals)));
      txBytes = buildAlgoAssetTransferTx(fromPubKey, toPubKey, assetId, amountRaw, params);
    }

    // 3. MPC EdDSA signing
    // Algorand Ed25519 signs the raw prefixed message "TX" + msgpack(txn), not a hash
    setSigningPhase("mpc-signing");
    const prefix = new TextEncoder().encode("TX");
    const signingMessage = new Uint8Array(prefix.length + txBytes.length);
    signingMessage.set(prefix, 0);
    signingMessage.set(txBytes, prefix.length);

    const { signature: sigRaw, sessionId } = await performMpcSign({
      algorithm: "eddsa",
      keyId: keyFile.id,
      hash: signingMessage,
      initPayload: {
        id: keyFile.id,
        algorithm: "eddsa",
        from: fromAddress,
        chainType: "algo",
        eddsaPublicKey: keyFile.eddsaPublicKey,
        algoTx: toBase64(txBytes),
      },
      headers: sensitiveHeaders(),
    });

    // 4. Assemble signed transaction
    const signedTx = assembleAlgoSignedTx(txBytes, sigRaw);

    if (confirmBeforeBroadcast) {
      setSignedRawTx(toBase64(signedTx));
      setTxResult({ status: "success", txHash: "sign-only" });
      setKeyFile(null); setPendingEncrypted(null);
      setStep("result");
      return;
    }

    // 5. Broadcast
    setSigningPhase("broadcasting");
    const txId = await broadcastAlgoTransaction(chain.rpcUrl, signedTx);

    fetch(apiUrl("/api/sign/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ keyShareId: keyFile.id, sessionId, txHash: txId, chainId: chain.id }),
    }).catch(() => {});

    onTxSubmitted?.(txId, to, amount);

    // 6. Poll for confirmation
    setPendingTxHash(txId);
    setSigningPhase("polling");
    const result = await waitForAlgoConfirmation(chain.rpcUrl, txId, () => {}, 30, 3000);

    setTxResult({
      status: result.confirmed ? "success" : "pending",
      txHash: txId,
      blockNumber: result.round,
    });
    if (result.confirmed) onTxConfirmed?.(txId);
    setKeyFile(null); setPendingEncrypted(null);
    setStep("result");

  } catch (err: unknown) {
    console.error("[send] ALGO Error:", err);
    setSigningError(friendlyError(err, t));
  } finally {
    clearClientKey(keyFile.id);
  }
}
