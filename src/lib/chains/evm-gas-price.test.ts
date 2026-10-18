import { describe, expect, test, afterEach } from "bun:test";
import { evmGasPriceWithHeadroom, evmLevelGasPrices, fetchEvmGasQuote } from "./evm-gas-price";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("evmGasPriceWithHeadroom", () => {
  test("ceil(1.25 x base fee) + tip (Sepolia 2026-10-18 numbers)", () => {
    // eth_gasPrice 5855 = base 4855 + tip 1000 -> ceil(6068.75) + 1000
    expect(evmGasPriceWithHeadroom({ gasPrice: 5855n, baseFee: 4855n })).toBe(7069n);
    // exact multiple of 4: no rounding
    expect(evmGasPriceWithHeadroom({ gasPrice: 1_000n, baseFee: 1_000n })).toBe(1_250n);
  });
  test("never below eth_gasPrice", () => {
    expect(evmGasPriceWithHeadroom({ gasPrice: 100n, baseFee: 10n })).toBe(103n);
    expect(evmGasPriceWithHeadroom({ gasPrice: 5n, baseFee: 10n })).toBe(13n);
  });
  test("no base fee -> eth_gasPrice", () => {
    expect(evmGasPriceWithHeadroom({ gasPrice: 777n, baseFee: null })).toBe(777n);
    expect(evmGasPriceWithHeadroom({ gasPrice: 777n, baseFee: 0n })).toBe(777n);
  });
});

describe("evmLevelGasPrices", () => {
  test("levels scale the headroom price", () => {
    // base 1000, tip 1000: standard 2250; low 0.8x = 1800 is under eth_gasPrice 2000 -> floored
    expect(evmLevelGasPrices({ gasPrice: 2_000n, baseFee: 1_000n })).toEqual({ low: 2_000n, medium: 2_250n, high: 2_925n });
    // base 1000, tip 0: standard 1250, low 1000
    expect(evmLevelGasPrices({ gasPrice: 1_000n, baseFee: 1_000n })).toEqual({ low: 1_000n, medium: 1_250n, high: 1_625n });
  });
  test("low never drops below base fee + tip when the tip dominates", () => {
    // base 1, tip 99: standard 101, 0.8x = 81 < eth_gasPrice 100
    const p = evmLevelGasPrices({ gasPrice: 100n, baseFee: 1n });
    expect(p.low).toBe(100n);
    expect(p.medium).toBe(101n);
  });
  test("no EIP-1559 keeps the plain multipliers", () => {
    expect(evmLevelGasPrices({ gasPrice: 1_000n, baseFee: null })).toEqual({ low: 800n, medium: 1_000n, high: 1_300n });
  });
});

describe("fetchEvmGasQuote", () => {
  function mockRpc(results: Record<string, unknown>) {
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const { method } = JSON.parse(String(init?.body));
      const r = results[method];
      if (r instanceof Error) return new Response(JSON.stringify({ error: { message: r.message } }));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: r }));
    }) as typeof fetch;
  }
  test("reads gas price and latest base fee", async () => {
    mockRpc({ eth_gasPrice: "0x16df", eth_getBlockByNumber: { baseFeePerGas: "0x12f7" } });
    expect(await fetchEvmGasQuote("http://rpc")).toEqual({ gasPrice: 5855n, baseFee: 4855n });
  });
  test("a failed block read drops only the base fee", async () => {
    mockRpc({ eth_gasPrice: "0x10", eth_getBlockByNumber: new Error("boom") });
    expect(await fetchEvmGasQuote("http://rpc")).toEqual({ gasPrice: 16n, baseFee: null });
  });
  test("a failed gas price read throws", async () => {
    mockRpc({ eth_gasPrice: new Error("down"), eth_getBlockByNumber: { baseFeePerGas: "0x1" } });
    await expect(fetchEvmGasQuote("http://rpc")).rejects.toThrow("down");
  });
});
