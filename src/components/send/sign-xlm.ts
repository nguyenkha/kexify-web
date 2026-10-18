import { toBase64, performMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../../lib/mpc";
import { authHeaders } from "../../lib/auth";
import { apiUrl } from "../../lib/apiBase";
import { sensitiveHeaders } from "../../lib/passkey";
import {
  strKeyToPublicKey,
  eddsaPubKeyToXlmAddress,
  buildXlmTransactionXdr,
  buildXlmCreateAccountXdr,
  checkXlmAccountExists,
  checkXlmTrustline,
  xlmHashForSigning,
  assembleXlmSignedTx,
  getXlmAccountInfo,
  broadcastXlmTransaction,
  waitForXlmConfirmation,
} from "../../lib/chains/xlmTx";
import type { SigningContext } from "./signing-flows";
import { mapSendError, LocalizedSendError } from "./send-error";
import { xlmDestinationBlockKey, xlmDestinationVerdict } from "../../lib/chains/xlm-destination";

export async function executeXlmSigningFlow(ctx: SigningContext): Promise<void> {
  const {
    keyFile, chain, asset, to, amount,
    xlmMemo, xlmFeeRates, feeLevel, confirmBeforeBroadcast,
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
    if (!clientKeys.has(keyFile.id)) {
      await restoreKeyHandles(keyFile.id, keyFile.share, keyFile.eddsaShare);
    }

    // 1. Derive the correct source address from keyFile.eddsaPublicKey.
    // cb-mpc's ecKey2pInfo() returns different publicKey values for party 0 (client)
    // vs party 1 (server). The signature verifies against party 0's key (client).
    // The server DB stores party 1's key (wrong for address derivation).
    // So we always derive fromAddress from keyFile.eddsaPublicKey here.
    const fromAddress = eddsaPubKeyToXlmAddress(keyFile.eddsaPublicKey);
    const fromPubKey = strKeyToPublicKey(fromAddress);

    const { sequence } = await getXlmAccountInfo(chain.rpcUrl, fromAddress);
    const feeStroops = xlmFeeRates?.[feeLevel] ?? 100;
    const amountStroops = BigInt(Math.round(parseFloat(amount.replace(/,/g, "")) * 1e7));
    const isTestnet = chain.rpcUrl.includes("testnet");

    // 2. Check the destination; XLM to a new account is a CREATE_ACCOUNT (at least 1 XLM), an issued asset needs an
    //    activated account that trusts it. Anything Stellar would reject on-chain is refused before signing.
    const destExists = await checkXlmAccountExists(chain.rpcUrl, to);
    const destTrusts = !asset.isNative && destExists && !!asset.contractAddress
      && await checkXlmTrustline(chain.rpcUrl, to, asset.symbol, asset.contractAddress);
    const blockKey = xlmDestinationBlockKey(xlmDestinationVerdict({ destExists, destTrusts, isNative: asset.isNative, amountStroops }));
    if (blockKey) throw new LocalizedSendError(t(blockKey, { symbol: asset.symbol }));

    const txXdr = destExists
      ? buildXlmTransactionXdr({
          from: fromAddress, to, amountStroops, feeStroops,
          sequence: sequence + 1n,
          asset: asset.isNative ? undefined : { code: asset.symbol, issuer: asset.contractAddress! },
          memo: xlmMemo || undefined,
        })
      : buildXlmCreateAccountXdr({
          from: fromAddress, to, amountStroops, feeStroops,
          sequence: sequence + 1n,
          memo: xlmMemo || undefined,
        });

    // 3. MPC EdDSA sign
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
        // Send client-computed eddsaPublicKey so the server can correct its DB
        eddsaPublicKey: keyFile.eddsaPublicKey,
        xlmTx: {
          to,
          amount: amount,
          asset: asset.isNative ? "XLM" : asset.symbol,
          ...(xlmMemo ? { memo: xlmMemo } : {}),
        },
      },
      headers: sensitiveHeaders(),
    });

    // 4. Assemble signed envelope
    const txBase64 = assembleXlmSignedTx(txXdr, fromPubKey, sigRaw);

    if (confirmBeforeBroadcast) {
      setSignedRawTx(txBase64);
      setTxResult({ status: "success", txHash: "sign-only" });
      setKeyFile(null);
      setStep("result");
      return;
    }

    // 5. Broadcast
    setSigningPhase("broadcasting");
    const txHash = await broadcastXlmTransaction(chain.rpcUrl, txBase64);

    fetch(apiUrl("/api/sign/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ keyShareId: keyFile.id, sessionId, txHash, chainId: chain.id }),
    }).catch(() => {});

    onTxSubmitted?.(txHash, to, amount);

    // 6. Poll for confirmation
    setPendingTxHash(txHash);
    setSigningPhase("polling");
    const result = await waitForXlmConfirmation(chain.rpcUrl, txHash, () => {}, 30, 3000);

    setTxResult({
      status: result.confirmed ? "success" : "pending",
      txHash,
      blockNumber: result.ledger,
    });
    if (result.confirmed) onTxConfirmed?.(txHash);
    setKeyFile(null);
    setStep("result");

  } catch (err: unknown) {
    console.error("[send] XLM Error:", err);
    setSigningError(mapSendError(err, t));
  } finally {
    clearClientKey(keyFile.id);
  }
}
