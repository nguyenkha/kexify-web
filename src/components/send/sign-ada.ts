import { performMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../../lib/mpc";
import { authHeaders } from "../../lib/auth";
import { apiUrl } from "../../lib/apiBase";
import { sensitiveHeaders } from "../../lib/passkey";
import {
  prepareAdaPaymentTx,
  hashTxBody,
  assembleAdaSignedTx,
  broadcastAdaTransaction,
  waitForAdaConfirmation,
  eddsaPubKeyToAdaAddress,
  extractEd25519Key,
  toBase64,
} from "../../lib/chains/adaTx";
import type { SigningContext } from "./signing-flows";
import { friendlyError } from "./signing-flows";

export async function executeAdaSigningFlow(ctx: SigningContext): Promise<void> {
  const {
    keyFile, chain, to, amount,
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

    // 1. Derive address
    const isTestnet = chain.name.includes("PREPROD") || chain.name.includes("TESTNET");
    const fromAddress = eddsaPubKeyToAdaAddress(keyFile.eddsaPublicKey, isTestnet);
    const vkey = extractEd25519Key(keyFile.eddsaPublicKey);

    // 2. Build transaction
    const amountLovelace = BigInt(Math.round(parseFloat(amount) * 1e6));
    const { txBody } = await prepareAdaPaymentTx(chain.rpcUrl, fromAddress, to, amountLovelace);

    // 3. Hash for signing (Blake2b-256)
    const txHash = hashTxBody(txBody);

    // 4. MPC EdDSA signing
    setSigningPhase("mpc-signing");
    const { signature: sigRaw, sessionId } = await performMpcSign({
      algorithm: "eddsa",
      keyId: keyFile.id,
      hash: txHash,
      initPayload: {
        id: keyFile.id,
        algorithm: "eddsa",
        from: fromAddress,
        chainType: "ada",
        eddsaPublicKey: keyFile.eddsaPublicKey,
        adaTx: toBase64(txBody),
      },
      headers: sensitiveHeaders(),
    });

    // 5. Assemble signed transaction
    const signedTx = assembleAdaSignedTx(txBody, vkey, sigRaw);

    if (confirmBeforeBroadcast) {
      setSignedRawTx(toBase64(signedTx));
      setTxResult({ status: "success", txHash: "sign-only" });
      setKeyFile(null); setPendingEncrypted(null);
      setStep("result");
      return;
    }

    // 6. Broadcast
    setSigningPhase("broadcasting");
    const txId = await broadcastAdaTransaction(chain.rpcUrl, signedTx);

    fetch(apiUrl("/api/sign/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ keyShareId: keyFile.id, sessionId, txHash: txId, chainId: chain.id }),
    }).catch(() => {});

    onTxSubmitted?.(txId, to, amount);

    // 7. Poll for confirmation
    setPendingTxHash(txId);
    setSigningPhase("polling");
    const result = await waitForAdaConfirmation(chain.rpcUrl, txId, 30, 5000);

    setTxResult({
      status: result.confirmed ? "success" : "pending",
      txHash: txId,
      blockNumber: result.blockHeight,
    });
    if (result.confirmed) onTxConfirmed?.(txId);
    setKeyFile(null); setPendingEncrypted(null);
    setStep("result");

  } catch (err: unknown) {
    console.error("[send] ADA Error:", err);
    setSigningError(friendlyError(err, t));
  } finally {
    clearClientKey(keyFile.id);
  }
}
