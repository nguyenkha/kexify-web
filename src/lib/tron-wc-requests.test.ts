// WalletConnect TRON request / response shapes (Reown TRON RPC reference), same as the iOS wallet.
import { describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha256";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "../shared/utils";
import { FROM, TO, USDT, rawData, trc20Call, trxTransfer } from "../../../api/src/chains/tron-test-fixtures";
import { classifySignRequest } from "../../../api/src/sign-request";
import { assembleSignedTx, hashForSigning } from "./chains/tronTx";
import {
  TRON_MAINNET_CHAIN, assertTronMainnet, parseTronSignMessage, parseTronSignTransaction, tronMessageHash, tronProposalSupport,
} from "./tron-wc-requests";

const txOf = (raw: Uint8Array) => ({ txID: bytesToHex(sha256(raw)), raw_data: { contract: [] }, raw_data_hex: bytesToHex(raw), visible: false });

describe("tron_signTransaction params", () => {
  const raw = rawData(trc20Call(FROM, USDT, "095ea7b3", TO, 7n));

  test("v1 flat and legacy nested `transaction.transaction` read the same", () => {
    const flat = parseTronSignTransaction({ address: FROM, transaction: txOf(raw) }, FROM);
    const legacy = parseTronSignTransaction({ address: FROM, transaction: { transaction: txOf(raw) } }, FROM);
    expect(flat).toEqual(legacy);
    expect(flat.decoded).toMatchObject({ kind: "trc20_approve", owner: FROM, to: TO, amount: 7n, contractAddress: USDT });
  });

  test("the sheet reads the signed bytes, not the dApp's JSON raw_data", () => {
    const lying = { ...txOf(rawData(trxTransfer(FROM, TO, 1))), raw_data: { contract: [{ type: "TransferContract", parameter: { value: { amount: 999 } } }] } };
    expect(parseTronSignTransaction({ transaction: lying }, FROM).decoded.amount).toBe(1n);
  });

  test("refuses a txID that is not sha256(raw_data_hex), another owner / address, missing or malformed fields", () => {
    expect(() => parseTronSignTransaction({ transaction: { ...txOf(raw), txID: "00".repeat(32) } }, FROM)).toThrow("sha256");
    expect(() => parseTronSignTransaction({ transaction: txOf(raw) }, TO)).toThrow("not owned");
    expect(() => parseTronSignTransaction({ address: TO, transaction: txOf(raw) }, FROM)).toThrow("not this account");
    expect(() => parseTronSignTransaction({ transaction: { ...txOf(raw), raw_data_hex: "zz" } }, FROM)).toThrow("malformed");
    expect(() => parseTronSignTransaction({ transaction: { ...txOf(raw), raw_data: undefined } }, FROM)).toThrow("malformed");
    expect(() => parseTronSignTransaction(null, FROM)).toThrow("Missing params");
    expect(() => parseTronSignTransaction({ transaction: txOf(rawData(trc20Call(FROM, USDT, "d73dd623", TO, 1n))) }, FROM)).toThrow();
  });

  test("the answer is the signed transaction object (txID, raw_data, raw_data_hex, visible, signature[])", () => {
    const { tx } = parseTronSignTransaction({ transaction: txOf(rawData(trxTransfer(FROM, TO, 1))) }, FROM);
    expect(bytesToHex(hashForSigning(tx))).toBe(tx.txID);
    const signed = JSON.parse(assembleSignedTx(tx, 0x1234n, 0x5678n, 1).signedTxJson);
    expect(Object.keys(signed).sort()).toEqual(["raw_data", "raw_data_hex", "signature", "txID", "visible"]);
    expect(signed.txID).toBe(tx.txID);
    expect(signed.signature).toHaveLength(1);
    expect(signed.signature[0]).toMatch(/^[0-9a-f]{130}$/);
  });
});

describe("tron_signMessage", () => {
  test("plain-text message; `0x`-looking text is still text", () => {
    expect(new TextDecoder().decode(parseTronSignMessage({ address: FROM, message: "Sign in\nNonce: 42" }, FROM))).toBe("Sign in\nNonce: 42");
    expect(parseTronSignMessage({ message: "0xabcd" }, FROM)).toEqual(new TextEncoder().encode("0xabcd"));
    expect(() => parseTronSignMessage({ message: "" }, FROM)).toThrow();
    expect(() => parseTronSignMessage({ address: TO, message: "hi" }, FROM)).toThrow("not this account");
  });

  test("digest = keccak(\\x19TRON Signed Message:\\n + byte length + message), the one the API re-derives", () => {
    const msg = new TextEncoder().encode("héllo"); // 6 bytes, 5 characters
    expect(tronMessageHash(msg)).toEqual(keccak_256(new Uint8Array([...new TextEncoder().encode("\x19TRON Signed Message:\n6"), ...msg])));
    const b64 = Buffer.from(tronMessageHash(msg)).toString("base64");
    const r = classifySignRequest({ id: "k1", data: b64, from: FROM, messageType: "tron_signMessage", raw: bytesToHex(msg) }, { maxBatch: 1 });
    expect(r.msgPolicyType).toBe("personal_sign");
  });
});

describe("TRON chain id", () => {
  test("proposal: mainnet served, a required non-mainnet chain refused, optional ones left out", () => {
    expect(tronProposalSupport({ tron: { chains: [TRON_MAINNET_CHAIN] } }, undefined)).toEqual({ ok: true, offerAccounts: true });
    expect(tronProposalSupport({ tron: { chains: ["tron:0xcd8690dc"] } }, undefined)).toEqual({ ok: false, unsupportedChains: ["tron:0xcd8690dc"] });
    expect(tronProposalSupport({ "tron:0xcd8690dc": {} }, undefined)).toEqual({ ok: false, unsupportedChains: ["tron:0xcd8690dc"] });
    expect(tronProposalSupport(undefined, { tron: { chains: ["tron:0xcd8690dc", TRON_MAINNET_CHAIN] } })).toEqual({ ok: true, offerAccounts: true });
    expect(tronProposalSupport(undefined, { tron: { chains: ["tron:0xcd8690dc"] } })).toEqual({ ok: true, offerAccounts: false });
    expect(tronProposalSupport({ eip155: { chains: ["eip155:1"] } }, undefined)).toEqual({ ok: true, offerAccounts: false });
  });

  test("requests are signed for mainnet only", () => {
    expect(() => assertTronMainnet(TRON_MAINNET_CHAIN)).not.toThrow();
    expect(() => assertTronMainnet("tron:0xcd8690dc")).toThrow("mainnet only");
    expect(() => assertTronMainnet(undefined)).toThrow();
  });
});
