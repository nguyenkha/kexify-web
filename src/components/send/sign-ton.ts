import { performMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../../lib/mpc";
import { authHeaders } from "../../lib/auth";
import { apiUrl } from "../../lib/apiBase";
import { sensitiveHeaders } from "../../lib/passkey";
import {
  buildTonTransferMessage,
  assembleTonSignedMessage,
  broadcastTonTransaction,
  waitForTonConfirmation,
  getTonSeqno,
  isTonWalletInitialized,
} from "../../lib/chains/tonTx";
import { publicKeyToTonAddress } from "../../lib/chains/tonAdapter";
import type { SigningContext } from "./signing-flows";
import { friendlyError } from "./signing-flows";

export async function executeTonSigningFlow(ctx: SigningContext): Promise<void> {
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

    // 1. Derive address, get seqno, and check if wallet is initialized
    const fromAddress = publicKeyToTonAddress(keyFile.eddsaPublicKey);
    const [seqno, walletInitialized] = await Promise.all([
      getTonSeqno(chain.rpcUrl, fromAddress),
      isTonWalletInitialized(chain.rpcUrl, fromAddress),
    ]);

    // 2. Build unsigned transfer message
    const { hash, unsignedBody } = buildTonTransferMessage({
      eddsaPubKeyHex: keyFile.eddsaPublicKey,
      to,
      amount,
      seqno,
    });

    // 3. MPC EdDSA signing
    setSigningPhase("mpc-signing");

    const { signature: sigRaw, sessionId } = await performMpcSign({
      algorithm: "eddsa",
      keyId: keyFile.id,
      hash,
      initPayload: {
        id: keyFile.id,
        algorithm: "eddsa",
        from: fromAddress,
        chainType: "ton",
        unsignedTx: unsignedBody,
        eddsaPublicKey: keyFile.eddsaPublicKey,
        tonTx: { to, amount, seqno },
      },
      headers: sensitiveHeaders(),
    });

    // 4. Assemble signed external message (include state init if wallet not yet deployed)
    const signedBoc = assembleTonSignedMessage(fromAddress, unsignedBody, sigRaw, {
      eddsaPubKeyHex: keyFile.eddsaPublicKey,
      includeStateInit: !walletInitialized,
    });

    if (confirmBeforeBroadcast) {
      setSignedRawTx(signedBoc);
      setTxResult({ status: "success", txHash: "sign-only" });
      setKeyFile(null); setPendingEncrypted(null);
      setStep("result");
      return;
    }

    // 5. Broadcast
    setSigningPhase("broadcasting");
    const txHash = await broadcastTonTransaction(chain.rpcUrl, signedBoc);

    fetch(apiUrl("/api/sign/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ keyShareId: keyFile.id, sessionId, txHash, chainId: chain.id }),
    }).catch(() => {});

    onTxSubmitted?.(txHash, to, amount);

    // 6. Poll for confirmation (check seqno increment)
    setPendingTxHash(txHash);
    setSigningPhase("polling");
    const result = await waitForTonConfirmation(chain.rpcUrl, fromAddress, seqno, () => {}, 30, 3000);

    setTxResult({
      status: result.confirmed ? "success" : "pending",
      txHash,
    });
    if (result.confirmed) onTxConfirmed?.(txHash);
    setKeyFile(null); setPendingEncrypted(null);
    setStep("result");

  } catch (err: unknown) {
    console.error("[send] TON Error:", err);
    setSigningError(friendlyError(err, t));
  } finally {
    clearClientKey(keyFile.id);
  }
}
