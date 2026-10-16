// WalletConnect request (method + params) → review model. Decoding of the signed bytes stays in the
// chain decoders (Solana / TRON); this only picks the builder and feeds it.

import type { DecodedSolanaTx } from "../chains/solanaTx";
import type { TronDecodedTx } from "../chains/tron-raw-data-decoder";
import { decodeSolanaMessageParam } from "../solana-wc-message";
import { buildEvmTxReview, decodeEvmCall } from "./build-evm-tx-review";
import { buildMessageReview, buildTypedDataReview } from "./build-signature-review";
import { buildSolanaReview } from "./build-solana-review";
import { buildTronReview } from "./build-tron-review";
import type { NameLookup, PolicyCheckInput, Prices, ReviewModel, TokenLookup } from "./review-types";

export interface WcReviewContext {
  from: { address: string; name?: string };
  dappName: string;
  /** EVM chain id of the request (eip155:<id>). */
  chainId?: number;
  nativeSymbol: string;
  tokenOf: TokenLookup;
  prices: Prices;
  nameOf?: NameLookup;
  /** Saved or recent recipient (address book / history) → no first-time warning. */
  isKnownRecipient?: (address: string) => boolean;
  policy?: PolicyCheckInput | null;
  /** EVM: gas estimation failed (the tx likely reverts). */
  mayFail?: boolean;
  /** EVM: estimated fee in wei, null while estimating. */
  feeWei?: bigint | null;
  /** EVM approve: the allowance the user edited. */
  approveOverride?: bigint | null;
  /** EVM approve: formatted balance of the token ("1,250 USDC"). */
  tokenBalanceOf?: (token: string) => string | undefined;
  /** Approve: balance of the token in base units (spending-cap editor option). */
  tokenBalanceRawOf?: (token: string) => bigint | undefined;
  solana?: DecodedSolanaTx | null;
  /** TRON: decoded signed bytes (null = unreadable), estimated fee, raw_data_hex. */
  tron?: { decoded: TronDecodedTx | null; feeSun: bigint; raw?: string } | null;
}

/** UTF-8 text, or null for bytes that are not valid UTF-8 (non-fatal decode: the iOS JSC polyfill has no `fatal`). */
function utf8(bytes: Uint8Array): string | null {
  const s = new TextDecoder().decode(bytes);
  return s.includes("\uFFFD") ? null : s;
}

function utf8OrHex(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(h)) return hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return utf8(bytes) ?? hex;
}

/** null = method this screen does not review (the caller shows its raw fallback). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildWcRequestReview(method: string, params: any, c: WcReviewContext): ReviewModel | null {
  const firstTime = (a: string | undefined) => !!a && !!c.isKnownRecipient && !c.isKnownRecipient(a);
  switch (method) {
    case "eth_sendTransaction": {
      const tx = params?.[0] ?? {};
      const call = decodeEvmCall(tx.data, c.from.address, tx.to);
      const recipient = call.kind === "native" ? tx.to : call.kind === "transfer" ? call.to : undefined;
      return buildEvmTxReview({
        tx, from: c.from, nativeSymbol: c.nativeSymbol, token: tx.to ? c.tokenOf(tx.to) : undefined, tokenOf: c.tokenOf, mayFail: c.mayFail,
        tokenBalance: tx.to ? c.tokenBalanceOf?.(tx.to) : undefined, approveOverride: c.approveOverride,
        tokenBalanceRaw: tx.to ? c.tokenBalanceRawOf?.(tx.to) : undefined,
        feeWei: c.feeWei ?? null, prices: c.prices, nameOf: c.nameOf, policy: c.policy, firstTimeRecipient: firstTime(recipient),
      });
    }
    case "eth_signTypedData_v4":
      return buildTypedDataReview({ typedData: params?.[1] ?? "{}", from: c.from, chainId: c.chainId, tokenOf: c.tokenOf, prices: c.prices, nameOf: c.nameOf, policy: c.policy });
    case "personal_sign":
      return buildMessageReview({ kind: "personal", text: utf8OrHex(String(params?.[0] ?? "")), from: c.from });
    case "eth_sign":
      return buildMessageReview({ kind: "hash", text: String(params?.[1] ?? ""), from: c.from });
    case "solana_signMessage": {
      let text = String(params?.message ?? "");
      try {
        text = utf8(decodeSolanaMessageParam(text)) ?? text;
      } catch { /* not base58: keep as sent */ }
      return buildMessageReview({ kind: "solana", text, from: c.from });
    }
    case "tron_signMessage":
      return buildMessageReview({ kind: "tron", text: typeof params?.message === "string" ? params.message : "", from: c.from });
    case "solana_signTransaction":
    case "solana_signAndSendTransaction":
      if (!c.solana) return null;
      return buildSolanaReview({ decoded: c.solana, from: c.from, dappName: c.dappName, tokenOf: c.tokenOf, prices: c.prices, nameOf: c.nameOf, policy: c.policy, raw: params?.transaction });
    case "tron_signTransaction": {
      const d = c.tron?.decoded ?? null;
      return buildTronReview({
        decoded: d, from: c.from, token: d?.contractAddress ? c.tokenOf(d.contractAddress) : undefined, feeSun: c.tron?.feeSun ?? 0n,
        prices: c.prices, nameOf: c.nameOf, policy: c.policy, firstTimeRecipient: d && d.kind !== "trc20_approve" ? firstTime(d.to) : false,
        raw: c.tron?.raw, approveOverride: c.approveOverride,
        tokenBalanceRaw: d?.contractAddress ? c.tokenBalanceRawOf?.(d.contractAddress) : undefined,
      });
    }
    default:
      return null;
  }
}
