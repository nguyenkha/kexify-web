import { broadcastWithProxyFallback, utxosWithProxyFallback } from "../../lib/chains/chain-proxy-utxo";
import { hexToBytes, bytesToHex } from "../../shared/utils";
import { toBase64, performBatchMpcSign, clientKeys, restoreKeyHandles, clearClientKey } from "../../lib/mpc";
import { authHeaders } from "../../lib/auth";
import { apiUrl } from "../../lib/apiBase";
import { sensitiveHeaders } from "../../lib/passkey";
import { parseDerSignature, parseUnits } from "../../lib/chains/evmTx";
import {
  fetchUtxos as fetchDogeUtxos,
  buildDogeTransaction,
  legacySighash,
  getCompressedPublicKey,
  pubKeyHash,
  makeP2PKHScriptSig,
  serializeLegacyTx,
  computeLegacyTxid,
  broadcastDogeTx,
  waitForDogeConfirmation,
} from "../../lib/chains/dogeTx";
import type { SigningContext } from "./signing-flows";
import { buildWithUtxoInputCap } from "./build-with-utxo-input-cap";
import { mapSendError } from "./send-error";

/** DOGE send: P2PKH inputs, legacy sighash per input in one MPC batch; the server binds the inputs to DOGE mainnet. */
export async function executeDogeSigningFlow(ctx: SigningContext): Promise<void> {
  const {
    keyFile, chain, asset, address, to, amount,
    dogeFeeRate, manualUtxos, confirmBeforeBroadcast,
    onTxSubmitted, onTxConfirmed,
    setStep, setSigningPhase, setSignatureCount, setSigningError,
    setSignedRawTx, setTxResult, setPendingTxHash, setKeyFile,
    t,
  } = ctx;

  if (!dogeFeeRate) return;

  setStep("signing");
  setSigningPhase("building-tx");
  setSignatureCount(1);
  setSigningError(null);

  try {
    if (!clientKeys.has(keyFile.id)) {
      await restoreKeyHandles(keyFile.id, keyFile.share, keyFile.eddsaShare);
    }

    // 1. Fetch UTXOs and build transaction
    const utxos = manualUtxos ?? await utxosWithProxyFallback(chain, address, () => fetchDogeUtxos(address));
    const amountSats = parseUnits(amount, asset.decimals);
    const dogeTx = buildWithUtxoInputCap((max) => buildDogeTransaction(to, amountSats, utxos, dogeFeeRate, address, manualUtxos != null, max), t, asset);

    // 2. Compressed public key and its hash (the P2PKH the inputs pay)
    setSigningPhase("mpc-signing");
    const compressedPubKey = getCompressedPublicKey(bytesToHex(hexToBytes(keyFile.publicKey)));
    const pkHash = pubKeyHash(compressedPubKey);

    // DOGE tx payload for server-side verification
    const dogeTxPayload = {
      version: dogeTx.version,
      inputs: dogeTx.inputs.map((inp) => ({
        txid: inp.txid, vout: inp.vout, value: inp.value.toString(), sequence: inp.sequence,
      })),
      outputs: dogeTx.outputs.map((out) => ({
        value: out.value.toString(), scriptPubKey: bytesToHex(out.scriptPubKey),
      })),
      locktime: dogeTx.locktime,
    };

    // 3. One legacy sighash per input, batch-signed in a single MPC session
    const sighashes = dogeTx.inputs.map((_, i) => legacySighash(dogeTx, i, pkHash));
    setSignatureCount(sighashes.length);

    const { signatures: allSigs } = await performBatchMpcSign({
      keyId: keyFile.id,
      hashes: sighashes,
      initPayload: {
        id: keyFile.id, chainType: "doge", dogeTx: dogeTxPayload,
        pubKeyHash: toBase64(pkHash), from: address,
      },
      headers: sensitiveHeaders(),
    });

    const scriptSigs = allSigs.map((sig) => {
      const { r, s } = parseDerSignature(sig);
      return makeP2PKHScriptSig(r, s, compressedPubKey);
    });

    // 4. Assemble and serialize
    const rawHex = bytesToHex(serializeLegacyTx(dogeTx, scriptSigs));
    const txid = computeLegacyTxid(dogeTx, scriptSigs);

    if (confirmBeforeBroadcast) {
      setSignedRawTx(rawHex);
      setTxResult({ status: "success", txHash: "sign-only" });
      setKeyFile(null);
      setStep("result");
      return;
    }

    // 5. Broadcast
    setSigningPhase("broadcasting");
    const broadcastTxid = await broadcastWithProxyFallback(chain, address, rawHex, () => broadcastDogeTx(rawHex));

    fetch(apiUrl("/api/sign/broadcast"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ keyShareId: keyFile.id, txHash: broadcastTxid || txid, chainId: chain.id }),
    }).catch(() => {});

    onTxSubmitted?.(broadcastTxid || txid, to, amount);

    // 6. Wait for confirmation (1-minute blocks)
    setPendingTxHash(broadcastTxid || txid);
    setSigningPhase("polling");
    const result = await waitForDogeConfirmation(broadcastTxid || txid, () => {}, 60, 5000);

    setTxResult({
      status: result.confirmed ? "success" : "pending",
      txHash: broadcastTxid || txid,
      blockNumber: result.blockHeight,
    });
    if (result.confirmed) onTxConfirmed?.(broadcastTxid || txid);
    setKeyFile(null);
    setStep("result");

  } catch (err: unknown) {
    console.error("[send] DOGE Error:", err);
    setSigningError(mapSendError(err, t));
  } finally {
    clearClientKey(keyFile.id);
  }
}
