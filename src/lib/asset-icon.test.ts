import { describe, expect, test } from "bun:test";
import { showChainBadge } from "./asset-icon";

const eth = { isNative: true, iconUrl: "eth.png" };
describe("showChainBadge", () => {
  test("ETH on Ethereum / Sepolia: no badge", () => {
    expect(showChainBadge(eth, { type: "evm", evmChainId: 1, iconUrl: "eth.png" })).toBe(false);
    expect(showChainBadge(eth, { type: "evm", evmChainId: 11155111, iconUrl: "other.png" })).toBe(false);
  });
  test("ETH on an L2: coin icon with the chain badge", () => {
    expect(showChainBadge(eth, { type: "evm", evmChainId: 8453, iconUrl: "base.png" })).toBe(true);
  });
  test("BTC / SOL own chain: no badge", () => {
    expect(showChainBadge({ isNative: true, iconUrl: "btc.png" }, { type: "btc", evmChainId: null, iconUrl: "btc.png" })).toBe(false);
    expect(showChainBadge({ isNative: true, iconUrl: "sol.png" }, { type: "solana", evmChainId: null, iconUrl: "x.png" })).toBe(false);
  });
  test("native coin that is the chain's own logo (POL on Polygon): no badge", () => {
    expect(showChainBadge({ isNative: true, iconUrl: "pol.png" }, { type: "evm", evmChainId: 137, iconUrl: "pol.png" })).toBe(false);
  });
  test("tokens always get the badge", () => {
    expect(showChainBadge({ isNative: false, iconUrl: "usdc.png" }, { type: "evm", evmChainId: 1, iconUrl: "eth.png" })).toBe(true);
    expect(showChainBadge({ isNative: false, iconUrl: null }, { type: "solana", evmChainId: null, iconUrl: null })).toBe(true);
  });
});
