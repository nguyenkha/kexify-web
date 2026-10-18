// Custom EVM networks join the chain and asset lists only in Expert mode, and never shadow a built-in chainId.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import staticConfig from "../config.json";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const { setRecoveryActive } = await import("./recovery-flag");
const { fetchChains, fetchAssets } = await import("./api");

const anvil = { chain_id: 31337, name: "Anvil", rpc_url: "http://127.0.0.1:8545", symbol: "ETH", testnet: true, added_at: 1 };
const shadow = { ...anvil, chain_id: 1, name: "Fake mainnet" };
const save = (expert: boolean) =>
  store.set("kexify:config", JSON.stringify({ preferences: { expert_mode: expert }, custom_networks: [anvil, shadow] }));

beforeEach(() => {
  store.clear();
  setRecoveryActive(true); // bundled lists, no server
});
afterEach(() => setRecoveryActive(false));

describe("custom networks in the chain list", () => {
  test("Expert mode on: added after the built-ins, with its native asset; a built-in chainId is never shadowed", async () => {
    save(true);
    const chains = await fetchChains();
    expect(chains.length).toBe(staticConfig.chains.length + 1);
    const custom = chains.filter((c) => c.custom);
    expect(custom.map((c) => [c.evmChainId, c.displayName])).toEqual([[31337, "Anvil (31337)"]]);
    const assets = await fetchAssets(custom[0].id);
    expect(assets.map((a) => [a.symbol, a.isNative])).toEqual([["ETH", true]]);
  });

  test("Expert mode off: not listed", async () => {
    save(false);
    expect((await fetchChains()).some((c) => c.custom)).toBe(false);
    expect((await fetchAssets()).length).toBe(staticConfig.assets.length);
  });
});
