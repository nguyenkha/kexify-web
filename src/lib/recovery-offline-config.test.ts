// Recovery mode with the kexify server gone: chain, asset and settings lists come from the bundled config without a
// request, and custom tokens saved without a user id (no session in recovery) still reach the asset list.
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
const { fetchChains, fetchAssets, fetchSettings } = await import("./api");
const { getCustomTokens } = await import("./userOverrides");

const realFetch = globalThis.fetch;
let calls = 0;

beforeEach(() => {
  store.clear();
  calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error("server gone"); }) as unknown as typeof fetch;
});
afterEach(() => { setRecoveryActive(false); globalThis.fetch = realFetch; });

const token = (id: string) => ({ id, symbol: "TKN", name: "Token", decimals: 6, contract_address: id.split(":")[2],
  icon_url: null, chain_id: id.split(":")[1], added_at: 1 });

describe("recovery mode lists without the server", () => {
  test("chains, assets and settings come from the bundled config with no request", async () => {
    setRecoveryActive(true);
    expect(await fetchChains()).toEqual(staticConfig.chains as never);
    expect((await fetchAssets()).length).toBe(staticConfig.assets.length);
    expect(await fetchSettings()).toEqual(staticConfig.preferences as never);
    expect(calls).toBe(0);
  });

  test("a custom token saved under the bare key (no session) is listed", async () => {
    setRecoveryActive(true);
    const id = `custom:${staticConfig.chains[0].id}:0xabc`;
    store.set("kexify:config", JSON.stringify({ custom_tokens: [token(id)] }));
    store.set("kexify:config:someone-else", JSON.stringify({ custom_tokens: [] }));
    expect(getCustomTokens().map((t) => t.id)).toEqual([id]);
    expect((await fetchAssets()).some((a) => a.id === id)).toBe(true);
  });

  test("a signed-in user's entry wins over the bare key other screens write (hide balances)", async () => {
    const sub = "user-1";
    const jwt = `x.${btoa(JSON.stringify({ sub }))}.y`;
    const before = (globalThis as Record<string, unknown>).sessionStorage;
    (globalThis as Record<string, unknown>).sessionStorage = { getItem: (k: string) => (k === "secretkey_token" ? jwt : null) };
    try {
      const id = `custom:${staticConfig.chains[0].id}:0xdef`;
      store.set(`kexify:config:${sub}`, JSON.stringify({ custom_tokens: [token(id)] }));
      store.set("kexify:config", JSON.stringify({ hide_balances: true }));
      expect(getCustomTokens().map((t) => t.id)).toEqual([id]);
      setRecoveryActive(true);
      expect(getCustomTokens().map((t) => t.id)).toEqual([id]); // recovery with a cached identity: same entry
    } finally {
      (globalThis as Record<string, unknown>).sessionStorage = before;
    }
  });

  test("recovery with no identity reads the bare key, not another user's entry; a cached identity reads its own", () => {
    const bareId = `custom:${staticConfig.chains[0].id}:0x111`;
    const userId = `custom:${staticConfig.chains[0].id}:0x222`;
    store.set("kexify:config", JSON.stringify({ custom_tokens: [token(bareId)] }));
    store.set("kexify:config:old-user", JSON.stringify({ custom_tokens: [token(userId)] }));
    setRecoveryActive(true);
    expect(getCustomTokens().map((t) => t.id)).toEqual([bareId]);
    store.set("kxi:identity", JSON.stringify({ sub: "old-user" })); // lock screen cache, no session token
    expect(getCustomTokens().map((t) => t.id)).toEqual([userId]);
  });

  test("outside recovery the server is still asked first", async () => {
    await fetchChains();
    expect(calls).toBe(1);
  });
});
