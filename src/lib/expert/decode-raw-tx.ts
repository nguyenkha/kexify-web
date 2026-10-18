// Expert "Decode transaction": paste hex / base64 / base58, get a review model + plain facts.
// Shared by web and iOS (chain bundle `expert.decode`). Read-only: nothing here signs or broadcasts.

import { base58, base64 } from "@scure/base";
import { decodeSolanaTransaction, type DecodedSolanaTx } from "../chains/solanaTx";
import { buildEvmTxReview } from "../review/build-evm-tx-review";
import { buildSolanaReview } from "../review/build-solana-review";
import { buildUtxoTxReview } from "../review/build-utxo-tx-review";
import { formatUnits } from "../review/review-format";
import type { Prices, ReviewModel } from "../review/review-types";
import { hexToBytes } from "../../shared/utils";
import { decodeEvmRawTx, type DecodedEvmTx } from "./evm-raw-tx-decode";
import { decodePsbt, decodeUtxoRawTx, PSBT_MAGIC, type DecodedUtxoTx } from "./utxo-raw-tx-decode";
import { UTXO_NETWORKS, type UtxoNetwork } from "./utxo-script-address";
import { solanaSignatureState, type SolanaSignatureState } from "./solana-signature-check";

export type DecodedRawTx =
  | { kind: "evm"; tx: DecodedEvmTx }
  | { kind: "solana"; tx: DecodedSolanaTx; base64: string; signatures: SolanaSignatureState }
  | { kind: "utxo"; tx: DecodedUtxoTx; network: UtxoNetwork };

/** One "label: value" line under the review; `key` is an i18n key (expert.decode.fact.*). */
export interface DecodeFact {
  key: string;
  value: string;
  /** Localised value instead of `value` (yes / no, "contract creation"). */
  valueKey?: string;
}

/**
 * Pasted text → candidate bytes: 0x/hex, else base64 and/or base58. A string can be valid in both alphabets
 * (base58 ⊂ base64 chars), so both readings are returned and the decoder tries each.
 */
export function parseTxInput(input: string): Uint8Array[] {
  const s = input.replace(/\s+/g, "");
  if (!s) throw new Error("Paste a transaction");
  const hex = s.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) return [hexToBytes(hex)];
  const out: Uint8Array[] = [];
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) out.push(base64.decode(s));
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) out.push(base58.decode(s));
  if (!out.length) throw new Error("Not hex, base64 or base58");
  return out;
}

const looksEvm = (b: Uint8Array) => b[0] >= 0xc0 || ([1, 2, 3, 4].includes(b[0]) && b[1] >= 0xc0);
// Bitcoin-family version 1 or 2, little-endian.
const looksUtxo = (b: Uint8Array) => b.length > 10 && (b[0] === 1 || b[0] === 2) && b[1] === 0 && b[2] === 0 && b[3] === 0;

/** Detect the format and decode; `utxoNetwork` only picks the address encoding for BTC / LTC / DOGE. */
export function decodeRawTx(input: string, utxoNetwork: UtxoNetwork = "btc"): DecodedRawTx {
  const errors: string[] = [];
  for (const bytes of parseTxInput(input)) {
    const d = decodeBytes(bytes, utxoNetwork, errors);
    if (d) return d;
  }
  throw new Error(`Could not decode this transaction (${errors.join("; ")})`);
}

function decodeBytes(bytes: Uint8Array, utxoNetwork: UtxoNetwork, errors: string[]): DecodedRawTx | null {
  const attempt = <T>(label: string, f: () => T): T | null => {
    try {
      return f();
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      return null;
    }
  };
  if (PSBT_MAGIC.every((b, i) => bytes[i] === b)) {
    const tx = attempt("PSBT", () => decodePsbt(bytes, utxoNetwork));
    return tx && { kind: "utxo", tx, network: utxoNetwork };
  }
  if (looksEvm(bytes)) {
    const tx = attempt("EVM", () => decodeEvmRawTx(bytes));
    if (tx) return { kind: "evm", tx };
  }
  if (looksUtxo(bytes)) {
    const tx = attempt("UTXO", () => decodeUtxoRawTx(bytes, utxoNetwork));
    if (tx) return { kind: "utxo", tx, network: utxoNetwork };
  }
  return attempt("Solana", () => {
    const b64 = base64.encode(bytes);
    return { kind: "solana" as const, tx: decodeSolanaTransaction(b64), base64: b64, signatures: solanaSignatureState(bytes) };
  });
}

export interface DecodeReviewContext {
  /** Native symbol of the EVM chain with the tx's chainId (when the wallet knows it). */
  evmNativeSymbol?: string;
  /** Unsigned EVM tx: who would send it (simulation + review "from"). */
  from?: string;
  prices?: Prices;
}

export function buildDecodedReview(d: DecodedRawTx, ctx: DecodeReviewContext = {}): ReviewModel {
  const prices = ctx.prices ?? {};
  if (d.kind === "evm") {
    const t = d.tx;
    return buildEvmTxReview({
      tx: { to: t.to ?? undefined, value: t.value.toString(), data: t.data }, from: { address: t.from ?? ctx.from ?? "" },
      nativeSymbol: ctx.evmNativeSymbol ?? "ETH", feeWei: t.maxFeeWei, prices,
    });
  }
  if (d.kind === "solana") {
    return buildSolanaReview({ decoded: d.tx, from: { address: d.tx.from }, dappName: "", tokenOf: () => undefined, prices, raw: d.base64 });
  }
  return buildUtxoTxReview(d.tx, UTXO_NETWORKS[d.network].symbol, prices);
}

const gwei = (wei: bigint) => `${formatUnits(wei, 9)} gwei`;

/** Plain facts the review model has no slot for (type, chain, nonce, signed, hash). */
export function decodedFacts(d: DecodedRawTx): DecodeFact[] {
  const f: DecodeFact[] = [];
  const signed = (s: boolean): DecodeFact => ({ key: "expert.decode.fact.signed", value: "", valueKey: s ? "expert.decode.yes" : "expert.decode.no" });
  if (d.kind === "evm") {
    const t = d.tx;
    f.push({ key: "expert.decode.fact.format", value: ["Legacy", "EIP-2930", "EIP-1559", "", "EIP-7702"][t.type] });
    f.push({ key: "expert.decode.fact.chainId", value: String(t.chainId ?? ""), ...(t.chainId == null ? { valueKey: "expert.decode.noChainId" } : {}) });
    f.push({ key: "expert.decode.fact.nonce", value: t.nonce.toString() });
    f.push({ key: "expert.decode.fact.gasLimit", value: t.gasLimit.toString() });
    if (t.gasPrice != null) f.push({ key: "expert.decode.fact.gasPrice", value: gwei(t.gasPrice) });
    if (t.maxFeePerGas != null) f.push({ key: "expert.decode.fact.maxFee", value: gwei(t.maxFeePerGas) });
    if (t.maxPriorityFeePerGas != null) f.push({ key: "expert.decode.fact.priorityFee", value: gwei(t.maxPriorityFeePerGas) });
    if (t.to === null) f.push({ key: "expert.decode.fact.to", value: "", valueKey: "expert.decode.contractCreation" });
    if (t.accessListSize) f.push({ key: "expert.decode.fact.accessList", value: String(t.accessListSize) });
    if (t.authorizationCount) f.push({ key: "expert.decode.fact.authorizations", value: String(t.authorizationCount) });
    f.push(signed(t.signed));
    if (t.from) f.push({ key: "expert.decode.fact.sender", value: t.from });
    if (t.hash) f.push({ key: "expert.decode.fact.hash", value: t.hash });
  } else if (d.kind === "solana") {
    f.push({ key: "expert.decode.fact.format", value: d.tx.isVersioned ? "Solana v0" : "Solana legacy" });
    f.push({ key: "expert.decode.fact.feePayer", value: d.tx.from });
    f.push({ key: "expert.decode.fact.instructions", value: String(d.tx.numInstructions) });
    const sigKey = { unsigned: "expert.decode.no", partial: "expert.decode.partial", signed: "expert.decode.yes", invalid: "expert.decode.invalidSig" }[d.signatures];
    f.push({ key: "expert.decode.fact.signed", value: "", valueKey: sigKey });
  } else {
    const t = d.tx;
    f.push({ key: "expert.decode.fact.format", value: `${t.format === "psbt" ? "PSBT" : "Raw"} · ${t.segwit ? "segwit" : "legacy"} · v${t.version}` });
    f.push({ key: "expert.decode.fact.txid", value: t.txid });
    f.push({ key: "expert.decode.fact.locktime", value: String(t.locktime) });
    f.push(signed(t.inputs.length > 0 && t.inputs.every((i) => i.signed)));
    if (t.fee != null && t.fee < 0n) f.push({ key: "expert.decode.fact.negativeFee", value: formatUnits(-t.fee, 8) });
  }
  return f;
}

/** EIP-7702 delegations and pre-EIP-155 replayable txs deserve a visible warning in the tool. */
export function decodeWarnings(d: DecodedRawTx): string[] {
  const w: string[] = [];
  if (d.kind === "evm" && d.tx.authorizationCount > 0) w.push("expert.decode.warn.delegation");
  if (d.kind === "evm" && d.tx.chainId == null) w.push("expert.decode.warn.replayable");
  if (d.kind === "solana" && d.signatures === "invalid") w.push("expert.decode.warn.badSignature");
  return w;
}
