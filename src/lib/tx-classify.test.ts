import { describe, expect, test } from "bun:test";
import type { Asset, Transaction } from "../shared/types";
import { getAddress } from "ethers";
import { classifyNativeTx, mergeEvmActivity, readableMethod, withNativeKinds } from "./tx-classify";

const ME = "0x1111111111111111111111111111111111111111";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const SPENDER = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
const n = (v: bigint) => v.toString(16).padStart(64, "0");
const w = (a: string) => a.replace(/^0x/, "").padStart(64, "0");
const MAX = "f".repeat(64);

const assets: Asset[] = [
  { id: "1", symbol: "ETH", name: "Ether", decimals: 18, contractAddress: null, isNative: true, iconUrl: null, chainId: "c" },
  { id: "2", symbol: "USDC", name: "USD Coin", decimals: 6, contractAddress: USDC, isNative: false, iconUrl: null, chainId: "c" },
  { id: "3", symbol: "WETH", name: "Wrapped Ether", decimals: 18, contractAddress: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", isNative: false, iconUrl: null, chainId: "c" },
];
const ctx = { address: ME, assets };

function native(input: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    hash: "0xh", from: ME, to: USDC, value: "0", formatted: "0", symbol: "ETH", timestamp: 100,
    direction: "out", confirmed: true, isContractCall: true, input: "0x" + input, ...extra,
  };
}
const approve = (amt: string) => native("095ea7b3" + w(SPENDER) + amt);

describe("classifyNativeTx", () => {
  test("approve(spender, 0) is a revoke", () => {
    expect(classifyNativeTx(approve(n(0n)), ctx)).toEqual({ type: "revoke", symbol: "USDC", spender: getAddress(SPENDER) });
  });
  test("approve max is unlimited", () => {
    const k = classifyNativeTx(approve(MAX), ctx);
    expect(k).toMatchObject({ type: "approve", symbol: "USDC", unlimited: true, amount: null });
  });
  test("approve(n) shows the amount with the token's decimals", () => {
    expect(classifyNativeTx(approve(n(2_000_000n)), ctx)).toMatchObject({ type: "approve", unlimited: false, amount: "2" });
  });
  test("unknown token falls back to the callee name, then 'token'; no amount without decimals", () => {
    const other = "0x3333333333333333333333333333333333333333";
    expect(classifyNativeTx(native("095ea7b3" + w(SPENDER) + n(5n), { to: other, toName: "FOO" }), ctx))
      .toMatchObject({ symbol: "FOO", amount: null, unlimited: false });
    expect(classifyNativeTx(native("095ea7b3" + w(SPENDER) + n(5n), { to: other }), ctx)).toMatchObject({ symbol: "token" });
  });
  test("setApprovalForAll true / false", () => {
    const on = native("a22cb465" + w(SPENDER) + n(1n));
    const off = native("a22cb465" + w(SPENDER) + n(0n));
    expect(classifyNativeTx(on, ctx)).toMatchObject({ type: "approveNfts" });
    expect(classifyNativeTx(off, ctx)).toMatchObject({ type: "revokeNfts", operator: getAddress(SPENDER) });
  });
  test("other call is a contract call with the readable method", () => {
    expect(classifyNativeTx(native("2e1a7d4d" + n(1n), { method: "withdraw" }), ctx)).toEqual({ type: "call", method: "withdraw" });
    expect(classifyNativeTx(native("2e1a7d4d" + n(1n), { method: "0x2e1a7d4d" }), ctx)).toEqual({ type: "call", method: undefined });
  });
  test("plain send and token transfer calls stay unclassified", () => {
    expect(classifyNativeTx(native("", { input: "0x" }), ctx)).toBeNull();
    expect(classifyNativeTx(native("a9059cbb" + w(SPENDER) + n(1n)), ctx)).toBeNull();
  });
  test("readableMethod", () => {
    expect(readableMethod("swapExactTokensForETH")).toBe("swapExactTokensForETH");
    expect(readableMethod("0xdeadbeef")).toBeUndefined();
    expect(readableMethod(undefined)).toBeUndefined();
  });
});

function tok(hash: string, direction: "in" | "out", symbol: string, formatted: string, contract: string, ts = 100): Transaction {
  return { hash, from: ME, to: SPENDER, value: "1", formatted, symbol, timestamp: ts, direction, confirmed: true, tokenContract: contract };
}

describe("mergeEvmActivity", () => {
  test("token out + token in under one hash is a swap", () => {
    const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    const rows = mergeEvmActivity(
      [native("3593564c" + n(1n), { hash: "0xs", method: "execute" })],
      [tok("0xs", "out", "USDC", "1", USDC), tok("0xs", "in", "WETH", "0.0003", weth)],
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toEqual({ type: "swap", out: { symbol: "USDC", amount: "1" }, in: { symbol: "WETH", amount: "0.0003" } });
  });
  test("native out + token in is a swap", () => {
    const rows = mergeEvmActivity(
      [native("7ff36ab5" + n(1n), { hash: "0xs", value: "1000", formatted: "0.01" })],
      [tok("0xs", "in", "USDC", "25", USDC)],
      ctx,
    );
    expect(rows[0].kind).toMatchObject({ type: "swap", out: { symbol: "ETH" }, in: { symbol: "USDC" } });
  });
  test("single token transfer stays a token row; native approve wins its hash", () => {
    const rows = mergeEvmActivity([{ ...approve(n(0n)), hash: "0xa" }], [tok("0xt", "in", "USDC", "5", USDC, 200)], ctx);
    expect(rows.map((r) => r.hash)).toEqual(["0xt", "0xa"]);
    expect(rows[0].kind).toBeUndefined();
    expect(rows[1].kind).toMatchObject({ type: "revoke" });
  });
  test("an Aave withdraw (unlisted aToken burnt, USDC in) is a receive, not a swap", () => {
    const aToken = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
    const rows = mergeEvmActivity(
      [native("69328dec" + n(1n), { hash: "0xw", to: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5", method: "withdraw" })],
      [tok("0xw", "out", "aBasUSDC", "0.05", aToken), tok("0xw", "in", "USDC", "0.05", USDC)],
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "USDC", direction: "in", formatted: "0.05" });
    expect(rows[0].kind).toBeUndefined();
  });
  test("transfers of unlisted tokens are dropped", () => {
    const rows = mergeEvmActivity([], [tok("0xspam", "in", "AIRDROP", "1000", "0x4444444444444444444444444444444444444444")], ctx);
    expect(rows).toHaveLength(0);
  });
});

test("withNativeKinds annotates only classified rows", () => {
  const rows = withNativeKinds([approve(MAX), native("", { input: "0x" })], ctx);
  expect(rows[0].kind).toMatchObject({ type: "approve" });
  expect(rows[1].kind).toBeUndefined();
});

test("a 0-unit transfer of a listed token (address poisoning) is no row", () => {
  const rows = mergeEvmActivity([], [{ ...tok("0xp", "out", "USDC", "0", USDC), value: "0" }], ctx);
  expect(rows).toHaveLength(0);
});
