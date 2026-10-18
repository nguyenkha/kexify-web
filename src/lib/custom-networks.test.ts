import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertRpcChainId, ChainIdMismatchError, customNetworkAsset, customNetworkChain, customNetworkInputError, isCustomChain,
  rpcUrlError, verifyCustomNetwork, type CustomNetworkInput,
} from "./custom-networks";
import { isTestnetChain } from "./testnet";
import type { Chain } from "../shared/types";

const realFetch = globalThis.fetch;
let rpcAnswer: unknown = "0x7a69"; // 31337
beforeEach(() => {
  globalThis.fetch = (async () => Response.json({ jsonrpc: "2.0", id: 1, result: rpcAnswer })) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  rpcAnswer = "0x7a69";
});

const input = (p: Partial<CustomNetworkInput> = {}): CustomNetworkInput => ({
  name: "Anvil", chainId: "31337", rpcUrl: "http://127.0.0.1:8545", symbol: "ETH", explorerUrl: "", testnet: true, ...p,
});
const sepolia = { evmChainId: 11155111, name: "ETHEREUM_SEPOLIA", displayName: "Sepolia" } as Chain;

describe("RPC URL rules", () => {
  test("https anywhere, http only to this machine", () => {
    expect(rpcUrlError("https://rpc.example.org")).toBe(null);
    expect(rpcUrlError("http://127.0.0.1:8545")).toBe(null);
    expect(rpcUrlError("http://localhost:8545")).toBe(null);
    expect(rpcUrlError("http://[::1]:8545")).toBe(null);
    expect(rpcUrlError("http://192.168.1.5:8545")).toBe("customNetwork.err.http");
    expect(rpcUrlError("http://rpc.example.org")).toBe("customNetwork.err.http");
    expect(rpcUrlError("ws://127.0.0.1:8545")).toBe("customNetwork.err.http");
    expect(rpcUrlError("https://user:pw@rpc.example.org")).toBe("customNetwork.err.url");
    expect(rpcUrlError("not a url")).toBe("customNetwork.err.url");
  });
});

describe("input checks", () => {
  test("valid input passes; built-in or duplicate chain ids are refused", () => {
    expect(customNetworkInputError(input(), [sepolia], [])).toBe(null);
    expect(customNetworkInputError(input({ chainId: "11155111" }), [sepolia], [])).toBe("customNetwork.err.builtIn");
    expect(customNetworkInputError(input(), [], [{ chain_id: 31337, name: "x" } as never])).toBe("customNetwork.err.exists");
    expect(customNetworkInputError(input({ name: "ethereum" }), [{ ...sepolia, name: "ETHEREUM", displayName: "Ethereum" }], [])).toBe("customNetwork.err.nameTaken");
    expect(customNetworkInputError(input(), [], [{ chain_id: 1, name: "ANVIL" } as never])).toBe("customNetwork.err.nameTaken");
  });

  test("bad fields", () => {
    expect(customNetworkInputError(input({ name: " " }), [], [])).toBe("customNetwork.err.name");
    expect(customNetworkInputError(input({ chainId: "0" }), [], [])).toBe("customNetwork.err.chainId");
    expect(customNetworkInputError(input({ chainId: "0x7a69" }), [], [])).toBe("customNetwork.err.chainId");
    expect(customNetworkInputError(input({ chainId: "99999999999999999" }), [], [])).toBe("customNetwork.err.chainId");
    expect(customNetworkInputError(input({ symbol: "<b>" }), [], [])).toBe("customNetwork.err.symbol");
    expect(customNetworkInputError(input({ explorerUrl: "http://x" }), [], [])).toBe("customNetwork.err.explorer");
    expect(customNetworkInputError(input({ explorerUrl: "javascript:alert(1)" }), [], [])).toBe("customNetwork.err.explorer");
  });
});

describe("eth_chainId validation", () => {
  test("matching RPC: stored network", async () => {
    const n = await verifyCustomNetwork(input({ explorerUrl: "https://scan.example.org/" }));
    expect(n).toMatchObject({ chain_id: 31337, name: "Anvil", symbol: "ETH", testnet: true, explorer_url: "https://scan.example.org" });
  });

  test("RPC on another chain: refused with both ids", async () => {
    rpcAnswer = "0x1";
    const err = await verifyCustomNetwork(input()).catch((e) => e);
    expect(err).toBeInstanceOf(ChainIdMismatchError);
    expect([err.actual, err.declared]).toEqual([1, 31337]);
  });

  test("garbage answers are errors, not chain 0", async () => {
    for (const bad of [null, "", "0x", "0x0", 7, "zz"]) {
      rpcAnswer = bad;
      await expect(verifyCustomNetwork(input())).rejects.toThrow();
    }
  });

  test("assertRpcChainId before signing", async () => {
    await assertRpcChainId("http://127.0.0.1:8545", 31337);
    rpcAnswer = "0x1";
    await expect(assertRpcChainId("http://127.0.0.1:8545", 31337)).rejects.toThrow(/Nothing was signed/);
  });
});

describe("as a chain", () => {
  test("custom marker, testnet naming, native-only asset", () => {
    const n = { chain_id: 31337, name: "Anvil", rpc_url: "http://127.0.0.1:8545", symbol: "ETH", testnet: true, added_at: 0 };
    const chain = customNetworkChain(n);
    expect(chain).toMatchObject({ type: "evm", evmChainId: 31337, custom: true, displayName: "Anvil (31337)" });
    expect(isCustomChain(chain)).toBe(true);
    expect(isTestnetChain(chain.name)).toBe(true);
    expect(isTestnetChain(customNetworkChain({ ...n, testnet: false }).name)).toBe(false);
    expect(customNetworkAsset(n)).toMatchObject({ isNative: true, decimals: 18, symbol: "ETH", chainId: chain.id, contractAddress: null });
  });
});
