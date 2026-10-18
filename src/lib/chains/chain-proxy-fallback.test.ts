// Chain proxy fallback in evmAdapter / solanaAdapter: public read first, the proxy only after it failed (or came
// back empty after having rows), refusals pause the network. Fixtures in fixtures/chain-proxy were recorded from
// the local stack (v0.10.39) for KD's test wallet; solana-spl-* are hand-made in the same shape (no SPL holdings).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Asset, Chain } from "../../shared/types";
import baseBalance from "./fixtures/chain-proxy/base-balance.json";
import baseHistory from "./fixtures/chain-proxy/base-history.json";
import solanaBalance from "./fixtures/chain-proxy/solana-balance.json";
import solanaHistory from "./fixtures/chain-proxy/solana-history.json";
import solanaSplBalance from "./fixtures/chain-proxy/solana-spl-balance.json";
import solanaSplHistory from "./fixtures/chain-proxy/solana-spl-history.json";
import ethereumBalance from "./fixtures/chain-proxy/ethereum-balance.json";
import ethereumHistory from "./fixtures/chain-proxy/ethereum-history.json";
import arbitrumBalance from "./fixtures/chain-proxy/arbitrum-balance.json";
import arbitrumHistory from "./fixtures/chain-proxy/arbitrum-history.json";
import polygonBalance from "./fixtures/chain-proxy/polygon-balance.json";
import polygonHistory from "./fixtures/chain-proxy/polygon-history.json";

const g = globalThis as Record<string, unknown>;
const session = new Map<string, string>();
const mem = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
g.sessionStorage ??= mem;
g.localStorage ??= mem;
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };

const { evmAdapter } = await import("./evmAdapter");
const { solanaAdapter } = await import("./solanaAdapter");
const { proxyNetwork, resetChainProxyState, pauseMs } = await import("./chain-proxy-client");
const { parseEvmBalance, parseEvmHistory } = await import("./chain-proxy-evm");
const { exitRecoveryMode } = await import("../recovery");
// Other test files in the same run may have installed their own storage stubs or left recovery mode on.
const token = {
  set: () => (globalThis.sessionStorage as Storage).setItem("secretkey_token", "test-jwt"),
  clear: () => (globalThis.sessionStorage as Storage).removeItem("secretkey_token"),
};

const EVM_ADDR = "0x419a5065a29fcfc1f8088dae931f187501592b02";
const SOL_ADDR = "kBj1SyMJT8CJxm5HjWnYEgncNouuwCgmHAkYKzFCaVn";
const LITHO = "0xb756c679db8c1dd70060cde2e9ac63856e035d63"; // the spam token in the recorded wallet
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const chain = (name: string, type: "evm" | "solana", explorerUrl: string, rpcUrl: string): Chain => ({
  id: name.toLowerCase(), name, displayName: name, type, coinType: type === "evm" ? 60 : 501,
  evmChainId: type === "evm" ? 8453 : null, rpcUrl, explorerUrl, iconUrl: null,
});
const BASE = chain("BASE", "evm", "https://basescan.org", "https://base-rpc.test");
const BASE_SEPOLIA = chain("BASE_SEPOLIA", "evm", "https://sepolia.basescan.org", "https://base-sepolia-rpc.test");
const SOLANA = chain("SOLANA", "solana", "https://solscan.io", "https://solana-rpc.test");

const asset = (id: string, symbol: string, decimals: number, contractAddress: string | null): Asset => ({
  id, symbol, name: symbol, decimals, contractAddress, isNative: contractAddress === null, iconUrl: null, chainId: "x",
});
const ETH = asset("eth", "ETH", 18, null);
const USDC_BASE = asset("usdc", "USDC", 6, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const KNOWN_LITHO = asset("litho", "LITHO", 9, LITHO);
const SOL = asset("sol", "SOL", 9, null);
const USDC_SPL = asset("usdc-sol", "USDC", 6, USDC_SOL);

type Handler = (url: string, body: Record<string, unknown> | null) => Response | Promise<Response>;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;
let proxyCalls: string[] = [];

/** Routes /api/chain/* to `proxy`, everything else (public nodes) to `pub`. */
function mockFetch(pub: Handler, proxy: Handler) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes("/api/chain/")) {
      proxyCalls.push(url.replace(/^.*\/api\/chain\//, ""));
      return proxy(url, body);
    }
    return pub(url, body);
  }) as typeof fetch;
}
const rpcError: Handler = () => json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "limit" } });
const networkDown: Handler = () => { throw new TypeError("Failed to fetch"); };
const proxyFrom = (balance: unknown, history: unknown): Handler => (url) => json(url.endsWith("/balance") ? balance : history);

beforeEach(() => {
  resetChainProxyState();
  proxyCalls = [];
  exitRecoveryMode();
  token.set();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("proxyNetwork", () => {
  test("served mainnets only, and only with a session", () => {
    expect(proxyNetwork(BASE)).toBe("base");
    expect(proxyNetwork(SOLANA)).toBe("solana");
    expect(proxyNetwork(BASE_SEPOLIA)).toBeNull();
    expect(proxyNetwork({ name: "OPTIMISM" })).toBeNull();
    token.clear();
    expect(proxyNetwork(BASE)).toBeNull();
  });
  test("pause lengths match iOS", () => {
    expect(pauseMs(429, true)).toBe(600_000);
    expect(pauseMs(403, false)).toBe(120_000);
    expect(pauseMs(502, true)).toBe(120_000);
    expect(pauseMs(500, true)).toBe(120_000);
    expect(pauseMs(401, false)).toBeNull();
  });
});

describe("evmAdapter balances", () => {
  test("public read ok: the proxy is never called", async () => {
    mockFetch(() => json({ jsonrpc: "2.0", id: 1, result: "0x10" }), () => json({}, 500));
    const r = await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE, ETH);
    expect(r?.balance).toBe("16");
    expect(proxyCalls).toEqual([]);
  });

  test("public RPC error: native from the proxy (no longer a silent zero)", async () => {
    mockFetch(rpcError, proxyFrom(baseBalance, baseHistory));
    const r = await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE, ETH);
    expect(r?.balance).toBe(BigInt("0x87956c5d472").toString());
    expect(r?.formatted).toBe("0.000009317239870578");
    expect(proxyCalls).toEqual(["base/balance"]);
  });

  test("failed token reads come from the same proxy answer; unknown (spam) tokens are dropped", async () => {
    mockFetch(networkDown, proxyFrom(baseBalance, baseHistory));
    const native = await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE, ETH);
    const tokens = await evmAdapter.fetchTokenBalances(EVM_ADDR, BASE, [USDC_BASE, KNOWN_LITHO]);
    expect(native).not.toBeNull();
    expect(tokens.map((t) => [t.asset.symbol, t.balance])).toEqual([["LITHO", "9000000000"]]);
    // Without LITHO in the app's list nothing of the proxy's token list is shown.
    expect(await evmAdapter.fetchTokenBalances(EVM_ADDR, BASE, [USDC_BASE])).toEqual([]);
    expect(proxyCalls).toEqual(["base/balance"]); // one call shared by native + tokens
  });

  test("tokens read fine publicly are kept; only the failed one is filled", async () => {
    mockFetch((_u, body) => {
      const to = ((body?.params as unknown[])?.[0] as { to?: string })?.to;
      return to === USDC_BASE.contractAddress ? json({ jsonrpc: "2.0", id: 1, result: "0x" + (5_000_000).toString(16) }) : rpcError("", null);
    }, proxyFrom(baseBalance, baseHistory));
    const tokens = await evmAdapter.fetchTokenBalances(EVM_ADDR, BASE, [USDC_BASE, KNOWN_LITHO]);
    expect(tokens.map((t) => [t.asset.symbol, t.balance])).toEqual([["USDC", "5000000"], ["LITHO", "9000000000"]]);
  });

  test("403 keeps the public result and pauses the network", async () => {
    mockFetch(rpcError, () => json({ error: "Address not owned" }, 403));
    expect(await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE, ETH)).toBeNull();
    expect(await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE, ETH)).toBeNull();
    expect(proxyCalls).toEqual(["base/balance"]);
    expect(proxyNetwork(BASE)).toBeNull();
    expect(proxyNetwork(SOLANA)).toBe("solana"); // per network
  });

  test("429 with fallback: public pauses the network", async () => {
    mockFetch(rpcError, () => json({ error: "Too many requests", scope: "user", fallback: "public" }, 429));
    expect(await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE, ETH)).toBeNull();
    expect(proxyNetwork(BASE)).toBeNull();
  });

  test("an answer for another address is ignored", async () => {
    mockFetch(rpcError, () => json({ ...baseBalance, address: "0x0000000000000000000000000000000000000001" }));
    expect(await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE, ETH)).toBeNull();
  });

  test("testnets never call the proxy", async () => {
    mockFetch(rpcError, proxyFrom(baseBalance, baseHistory));
    expect(await evmAdapter.fetchNativeBalance(EVM_ADDR, BASE_SEPOLIA, ETH)).toBeNull();
    expect(proxyCalls).toEqual([]);
  });
});

describe("recorded EVM answers parse", () => {
  test("empty wallets on ethereum / arbitrum / polygon read as zero, not as unreadable", () => {
    for (const [balance, history] of [[ethereumBalance, ethereumHistory], [arbitrumBalance, arbitrumHistory], [polygonBalance, polygonHistory]]) {
      expect(parseEvmBalance(balance)).toEqual({ native: 0n, tokens: new Map() });
      expect(parseEvmHistory(history, EVM_ADDR, ETH)).toEqual([]);
    }
  });
});

describe("evmAdapter history", () => {
  test("explorer down: native rows from the proxy, token rows by contract, spam tokens never", async () => {
    mockFetch(networkDown, proxyFrom(baseBalance, baseHistory));
    const native = await evmAdapter.fetchTransactions(EVM_ADDR, BASE, ETH, 1);
    expect(native.hasMore).toBe(false);
    expect(native.transactions.map((t) => [t.direction, t.formatted, t.symbol])).toEqual([
      ["out", "0.0000001", "ETH"], ["out", "0.0000001", "ETH"], ["out", "0.0000001", "ETH"], ["in", "0.00001", "ETH"],
    ]);
    expect(native.transactions[0]).toMatchObject({
      hash: "0x8de289a4258a68480d0814db607daa633fbd2121c2b77a2a195bd0cef65b27a6",
      to: "0x8970636c5cba597d7b1fc6d3b577f95a179593b3", confirmed: true, timestamp: 1792176147,
    });
    const litho = await evmAdapter.fetchTransactions(EVM_ADDR, BASE, KNOWN_LITHO, 1);
    expect(litho.transactions.map((t) => [t.direction, t.formatted])).toEqual([["in", "9"]]);
    expect((await evmAdapter.fetchTransactions(EVM_ADDR, BASE, USDC_BASE, 1)).transactions).toEqual([]);
  });

  test("explorer down and no proxy: the network error still throws; HTTP errors stay an empty page", async () => {
    token.clear();
    mockFetch(networkDown, proxyFrom(baseBalance, baseHistory));
    await expect(evmAdapter.fetchTransactions(EVM_ADDR, BASE, ETH, 1)).rejects.toThrow();
    mockFetch(() => json({}, 503), proxyFrom(baseBalance, baseHistory));
    expect(await evmAdapter.fetchTransactions(EVM_ADDR, BASE, ETH, 1)).toEqual({ transactions: [], hasMore: false });
    expect(proxyCalls).toEqual([]);
  });

  test("page 2 HTTP errors stay an empty page and never call the proxy", async () => {
    let publicCalls = 0;
    mockFetch(() => { publicCalls++; return json({}, 429); }, proxyFrom(solanaBalance, solanaHistory));
    expect(await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 2)).toEqual({ transactions: [], hasMore: false });
    expect(publicCalls).toBe(1);
    expect(proxyCalls).toEqual([]);
  });

  test("empty after having rows falls back; empty from the start does not", async () => {
    const item = { hash: "0xaa", from: { hash: EVM_ADDR }, to: { hash: "0xbb" }, value: "1", timestamp: "2026-10-16T00:00:00Z", confirmations: 3, raw_input: "0x" };
    let items: unknown[] = [];
    mockFetch(() => json({ items, next_page_params: null }), proxyFrom(baseBalance, baseHistory));
    expect((await evmAdapter.fetchTransactions(EVM_ADDR, BASE, ETH, 1)).transactions).toEqual([]);
    expect(proxyCalls).toEqual([]);
    items = [item];
    expect((await evmAdapter.fetchTransactions(EVM_ADDR, BASE, ETH, 1)).transactions).toHaveLength(1);
    items = [];
    expect((await evmAdapter.fetchTransactions(EVM_ADDR, BASE, ETH, 1)).transactions).toHaveLength(4);
    expect(proxyCalls).toEqual(["base/history"]);
  });
});

describe("solanaAdapter", () => {
  test("public RPC down: SOL from the proxy", async () => {
    mockFetch(networkDown, proxyFrom(solanaBalance, solanaHistory));
    const r = await solanaAdapter.fetchNativeBalance(SOL_ADDR, SOLANA, SOL);
    expect(r?.balance).toBe("885000");
    expect(r?.formatted).toBe("0.000885");
  });

  test("SPL balances by mint from the proxy", async () => {
    mockFetch(rpcError, proxyFrom(solanaSplBalance, solanaSplHistory));
    const tokens = await solanaAdapter.fetchTokenBalances(SOL_ADDR, SOLANA, [USDC_SPL]);
    expect(tokens.map((t) => [t.asset.symbol, t.balance, t.formatted])).toEqual([["USDC", "2500000", "2.5"]]);
  });

  test("history rows follow the adapter's display rules", async () => {
    mockFetch(networkDown, proxyFrom(solanaBalance, solanaHistory));
    const { transactions } = await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1);
    expect(transactions.map((t) => [t.direction, t.value, t.to, t.from, t.confirmed])).toEqual([
      ["out", "10000", "5LEVXfk3sGD28B4sVXTJ7RiCzzsAyk8VWJwQ8UGpqwcZ", SOL_ADDR, true], // 15000 out minus the 5000 fee
      ["in", "900000", SOL_ADDR, "5LEVXfk3sGD28B4sVXTJ7RiCzzsAyk8VWJwQ8UGpqwcZ", true],
    ]);
    expect(transactions[0].timestamp).toBe(1792151534);
  });

  test("SPL history: token rows on the token, pure SPL transfers off the SOL list, programs as contract calls", async () => {
    mockFetch(networkDown, proxyFrom(solanaSplBalance, solanaSplHistory));
    const usdc = await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, USDC_SPL, 1);
    expect(usdc.transactions.map((t) => [t.direction, t.formatted, t.from])).toEqual([
      ["in", "2.5", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"],
    ]);
    const sol = await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1);
    expect(sol.transactions.map((t) => [t.hash, t.isContractCall ?? false, t.to, t.failed])).toEqual([
      ["swap1", true, "Jupiter v6", true],
    ]);
  });

  test("rate-limited getTransaction reads (incomplete page) fall back; without a proxy the partial page stays", async () => {
    const sigs = [{ signature: "s1", blockTime: 1, confirmationStatus: "finalized", err: null }, { signature: "s2", blockTime: 2, confirmationStatus: "finalized", err: null }];
    const pub: Handler = (_u, body) => body?.method === "getSignaturesForAddress"
      ? json({ jsonrpc: "2.0", id: 1, result: sigs })
      : body?.params && (body.params as string[])[0] === "s1"
        ? json({ jsonrpc: "2.0", id: 1, result: { transaction: { message: { accountKeys: [SOL_ADDR], instructions: [] } }, meta: { fee: 0, preBalances: [0], postBalances: [5], preTokenBalances: [], postTokenBalances: [] } } })
        : json({}, 429);
    mockFetch(pub, proxyFrom(solanaBalance, solanaHistory));
    expect((await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1)).transactions).toHaveLength(2);
    expect(proxyCalls).toEqual(["solana/history"]);
    token.clear();
    const partial = await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1);
    expect(partial.transactions.map((t) => t.hash)).toEqual(["s1"]);
  });

  test("a page whose rows are all filtered out is not 'lost history' (no repeated proxy cost)", async () => {
    const sigs = [{ signature: "s1", blockTime: 1, confirmationStatus: "finalized", err: null }];
    const plainSol = { transaction: { message: { accountKeys: [SOL_ADDR], instructions: [] } }, meta: { fee: 0, preBalances: [0], postBalances: [5], preTokenBalances: [], postTokenBalances: [] } };
    // USDC had a row once (from the proxy), now the node's latest page has only a SOL transfer: still answered publicly.
    mockFetch(networkDown, proxyFrom(solanaSplBalance, solanaSplHistory));
    expect((await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, USDC_SPL, 1)).transactions).toHaveLength(1);
    mockFetch((_u, body) => json({ jsonrpc: "2.0", id: 1, result: body?.method === "getSignaturesForAddress" ? sigs : plainSol }), proxyFrom(solanaSplBalance, solanaSplHistory));
    expect((await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, USDC_SPL, 1)).transactions).toEqual([]);
    expect(proxyCalls).toEqual(["solana/history"]);
  });

  test("history the proxy filled counts as rows: a later empty public page falls back again", async () => {
    mockFetch(networkDown, proxyFrom(solanaBalance, solanaHistory));
    await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1);
    mockFetch(() => json({ jsonrpc: "2.0", id: 1, result: [] }), proxyFrom(solanaBalance, solanaHistory));
    expect((await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1)).transactions).toHaveLength(2);
    expect(proxyCalls).toEqual(["solana/history", "solana/history"]);
  });

  test("no proxy: an RPC error answer stays an empty page, as before", async () => {
    token.clear();
    mockFetch(rpcError, proxyFrom(solanaBalance, solanaHistory));
    expect(await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1)).toEqual({ transactions: [], hasMore: false });
  });

  test("getSignaturesForAddress RPC error falls back too", async () => {
    mockFetch(rpcError, proxyFrom(solanaBalance, solanaHistory));
    const { transactions } = await solanaAdapter.fetchTransactions(SOL_ADDR, SOLANA, SOL, 1);
    expect(transactions).toHaveLength(2);
    expect(proxyCalls).toEqual(["solana/history"]);
  });
});
