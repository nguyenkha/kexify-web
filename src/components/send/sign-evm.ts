import { hexToBytes } from "../../shared/utils";
import { toBase64, performMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../../lib/mpc";
import { authHeaders } from "../../lib/auth";
import { apiUrl } from "../../lib/apiBase";
import { sensitiveHeaders } from "../../lib/passkey";
import {
  buildTransaction,
  serializeForSigning,
  hashForSigning,
  parseDerSignature,
  recoverV,
  assembleSignedTx,
  broadcastTransaction,
  waitForReceipt,
  encodeErc20Transfer,
  parseUnits,
  type UnsignedTx,
} from "../../lib/chains/evmTx";
import { evmReceiptRpcUrls } from "../../lib/chains/evm-read-rpc-fallbacks";
import { getChainId } from "../sendTypes";
import { assertRpcChainId } from "../../lib/custom-networks";
import type { SigningContext } from "./signing-flows";
import { mapSendError } from "./send-error";

export async function executeSigningFlow(ctx: SigningContext): Promise<void> {
  const {
    keyFile, chain, asset, address, to, amount,
    gasPrice, gasLimit, confirmBeforeBroadcast,
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

    // 1. Build unsigned transaction. The chainId is the network's own (never the RPC's answer), and an RPC
    // serving another chain is refused: a custom or overridden RPC can never switch the chain being signed.
    let chainId: number;
    if (chain.evmChainId) {
      chainId = chain.evmChainId;
      await assertRpcChainId(chain.rpcUrl, chainId);
    } else {
      chainId = await getChainId(chain.rpcUrl);
    }
    const amountWei = parseUnits(amount, asset.decimals);

    let unsignedTx: UnsignedTx;
    if (asset.isNative) {
      unsignedTx = await buildTransaction({
        rpcUrl: chain.rpcUrl, from: address, to, value: amountWei,
        gasLimit, chainId, gasPrice: gasPrice ?? undefined,
      });
    } else {
      const calldata = encodeErc20Transfer(to, amountWei);
      unsignedTx = await buildTransaction({
        rpcUrl: chain.rpcUrl, from: address, to: asset.contractAddress!,
        value: 0n, data: calldata, gasLimit, chainId,
        gasPrice: gasPrice ?? undefined,
      });
    }

    // 2. MPC signing
    setSigningPhase("mpc-signing");
    const sighash = hashForSigning(unsignedTx);
    const serializedTx = serializeForSigning(unsignedTx);

    const { signature: sigRaw, sessionId } = await performMpcSign({
      algorithm: "ecdsa",
      keyId: keyFile.id,
      hash: sighash,
      initPayload: { id: keyFile.id, unsignedTx: toBase64(serializedTx), from: address, evmChainId: chainId },
      headers: sensitiveHeaders(),
    });

    // 3. Parse DER signature, determine recovery param, assemble signed tx
    const { r, s } = parseDerSignature(sigRaw);
    const pubKeyRaw = hexToBytes(keyFile.publicKey);
    const recoveryBit = recoverV(sighash, r, s, pubKeyRaw);
    const signedTx = assembleSignedTx(unsignedTx, r, s, recoveryBit);

    if (confirmBeforeBroadcast) {
      setSignedRawTx(signedTx.rawTransaction);
      setTxResult({ status: "success", txHash: "sign-only" });
      setKeyFile(null);
      setStep("result");
      return;
    }

    // 4. Broadcast
    setSigningPhase("broadcasting");
    const txHash = await broadcastTransaction(chain.rpcUrl, signedTx.rawTransaction);

    fetch(apiUrl("/api/sign/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ keyShareId: keyFile.id, sessionId, txHash, chainId: chain.id }),
    }).catch(() => {});

    onTxSubmitted?.(txHash, to, amount);

    // 5. Poll for receipt
    setPendingTxHash(txHash);
    setSigningPhase("polling");
    // The tx is already broadcast: if confirmation can't be read (RPC error/timeout),
    // show it as pending with its hash rather than as a failed transaction.
    try {
      const receipt = await waitForReceipt(evmReceiptRpcUrls(chain), txHash, () => {}, 60, 3000);
      setTxResult({ status: receipt.status, txHash, blockNumber: receipt.blockNumber });
      if (receipt.status === "success") onTxConfirmed?.(txHash);
    } catch (pollErr) {
      console.warn("[send] receipt polling failed, tx left pending:", pollErr);
      setTxResult({ status: "pending", txHash });
    }
    setKeyFile(null);
    setStep("result");

  } catch (err: unknown) {
    console.error("[send] Error:", err);
    setSigningError(mapSendError(err, t));
  } finally {
    clearClientKey(keyFile.id);
  }
}
