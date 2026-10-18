// Chain proxy fallback for BTC / LTC / BCH: public read first, the proxy only after it failed. Fixtures
// fixtures/chain-proxy/{bitcoin,litecoin,bitcoincash}-* were recorded from the local stack (API branch
// feat/api-utxo-chain-proxy) for KD's test wallet; bitcoin-utxos-hand.json is hand-made in the same shape.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Asset, Chain } from "../../shared/types";
import bitcoinBalance from "./fixtures/chain-proxy/bitcoin-balance.json";
import bitcoinHistory from "./fixtures/chain-proxy/bitcoin-history.json";
import bitcoinUtxos from "./fixtures/chain-proxy/bitcoin-utxos-hand.json";
import litecoinBalance from "./fixtures/chain-proxy/litecoin-balance.json";
import bitcoincashBalance from "./fixtures/chain-proxy/bitcoincash-balance.json";
import bitcoincashHistory from "./fixtures/chain-proxy/bitcoincash-history.json";

const g = globalThis as Record<string, unknown>;
const session = new Map<string, string>();
const mem = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
g.sessionStorage ??= mem;
g.localStorage ??= mem;
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };

const { btcAdapter } = await import("./btcAdapter");
const { ltcAdapter } = await import("./ltcAdapter");
const { bchAdapter } = await import("./bchAdapter");
const { proxyNetwork, resetChainProxyState } = await import("./chain-proxy-client");
const { parseUtxoList, parseUtxoHistory, utxosWithProxyFallback, feesWithProxyFallback, broadcastWithProxyFallback } = await import("./chain-proxy-utxo");
const { exitRecoveryMode } = await import("../recovery");
const token = { set: () => (globalThis.sessionStorage as Storage).setItem("secretkey_token", "test-jwt") };

const BTC_ADDR = bitcoinHistory.address;
const LTC_ADDR = litecoinBalance.address;
const BCH_ADDR = bitcoincashBalance.address;

const chain = (name: string, type: "btc" | "ltc" | "bch", explorerUrl: string, rpcUrl = ""): Chain => ({
  id: name.toLowerCase(), name, displayName: name, type, coinType: 0, evmChainId: null, rpcUrl, explorerUrl, iconUrl: null,
});
const BITCOIN = chain("BITCOIN", "btc", "https://mempool.space");
const BITCOIN_TESTNET = chain("BITCOIN_TESTNET", "btc", "https://mempool.space/testnet");
const LITECOIN = chain("LITECOIN", "ltc", "https://litecoinspace.org");
const BITCOIN_CASH = chain("BITCOIN_CASH", "bch", "https://blockchair.com/bitcoin-cash", "https://api.blockchair.com/bitcoin-cash");
const coin = (symbol: string): Asset => ({ id: symbol.toLowerCase(), symbol, name: symbol, decimals: 8, contractAddress: null, isNative: true, iconUrl: null, chainId: "x" });
const BTC = coin("BTC");

type Handler = (url: string) => Response | Promise<Response>;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;
let proxyCalls: string[] = [];

function mockFetch(pub: Handler, proxy: Handler) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/chain/")) {
      proxyCalls.push(url.replace(/^.*\/api\/chain\//, ""));
      return proxy(url);
    }
    return pub(url);
  }) as typeof fetch;
}
const networkDown: Handler = () => { throw new TypeError("Failed to fetch"); };
const httpError = (status: number): Handler => () => json({ error: "nope" }, status);

beforeEach(() => {
  resetChainProxyState();
  proxyCalls = [];
  exitRecoveryMode();
  token.set();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("UTXO networks", () => {
  test("mainnets map to the server's names; testnets are not proxied", () => {
    expect(proxyNetwork(BITCOIN)).toBe("bitcoin");
    expect(proxyNetwork(LITECOIN)).toBe("litecoin");
    expect(proxyNetwork(BITCOIN_CASH)).toBe("bitcoincash");
    expect(proxyNetwork(BITCOIN_TESTNET)).toBeNull();
  });
});

describe("balances", () => {
  test("public read ok: the proxy is never called", async () => {
    mockFetch(() => json({ chain_stats: { funded_txo_sum: 5000, spent_txo_sum: 1000 } }), () => json({}, 500));
    expect((await btcAdapter.fetchNativeBalance(BTC_ADDR, BITCOIN, BTC))?.balance).toBe("4000");
    expect(proxyCalls).toEqual([]);
  });

  test("BTC explorer HTTP error: the confirmed balance comes from the proxy", async () => {
    mockFetch(httpError(503), () => json({ ...bitcoinBalance, confirmed: "123456", unconfirmed: "-1000" }));
    const r = await btcAdapter.fetchNativeBalance(BTC_ADDR, BITCOIN, BTC);
    expect(r?.balance).toBe("123456");
    expect(proxyCalls).toEqual(["bitcoin/balance"]);
  });

  test("LTC: Blockbook and Esplora both down -> proxy; recorded zero wallet reads as zero", async () => {
    mockFetch(networkDown, () => json(litecoinBalance));
    expect((await ltcAdapter.fetchNativeBalance(LTC_ADDR, LITECOIN, coin("LTC")))?.balance).toBe("0");
    expect(proxyCalls).toEqual(["litecoin/balance"]);
  });

  test("BCH: Blockchair 430 -> proxy, for the bare CashAddr form too", async () => {
    mockFetch(httpError(430), () => json({ ...bitcoincashBalance, confirmed: "777" }));
    expect((await bchAdapter.fetchNativeBalance(BCH_ADDR.replace("bitcoincash:", ""), BITCOIN_CASH, coin("BCH")))?.balance).toBe("777");
  });

  test("no proxy answer: unreadable stays null; a refusal pauses the network", async () => {
    mockFetch(httpError(503), () => json({ error: "Too many requests", fallback: "public" }, 429));
    expect(await btcAdapter.fetchNativeBalance(BTC_ADDR, BITCOIN, BTC)).toBeNull();
    expect(proxyNetwork(BITCOIN)).toBeNull();
  });
});

describe("history", () => {
  test("explorer down: rows from the recorded proxy answer with the adapters' rules", async () => {
    mockFetch(networkDown, () => json(bitcoinHistory));
    const page = await btcAdapter.fetchTransactions(BTC_ADDR, BITCOIN, BTC, 1);
    expect(page.hasMore).toBe(false);
    expect(page.transactions.map((t) => [t.direction, t.value, t.from, t.to, t.formatted])).toEqual([
      ["out", "2000", BTC_ADDR, "13Z3Wko9ZfKS8Y9m1uuM7HPoEeYcqtNwZW", "0.00002"],
      ["in", "2000", "13Z3Wko9ZfKS8Y9m1uuM7HPoEeYcqtNwZW", BTC_ADDR, "0.00002"],
    ]);
    expect(page.transactions[0]).toMatchObject({ symbol: "BTC", confirmed: true, timestamp: 1792155826 });
  });

  test("HTTP error without a proxy answer stays an empty page; page 2 never calls the proxy", async () => {
    mockFetch(httpError(429), () => json({ error: "x", fallback: "public" }, 502));
    expect(await ltcAdapter.fetchTransactions(LTC_ADDR, LITECOIN, coin("LTC"), 1)).toEqual({ transactions: [], hasMore: false });
    resetChainProxyState();
    proxyCalls = [];
    expect(await btcAdapter.fetchTransactions(BTC_ADDR, BITCOIN, BTC, 2)).toEqual({ transactions: [], hasMore: false });
    expect(proxyCalls).toEqual([]);
  });

  test("empty after having rows falls back", async () => {
    let rows = 1;
    const tx = { txid: "aa".repeat(32), status: { confirmed: true, block_time: 1 }, vin: [], vout: [{ scriptpubkey_address: BTC_ADDR, value: 5 }] };
    mockFetch(() => json(Array.from({ length: rows }, () => tx)), () => json(bitcoinHistory));
    expect((await btcAdapter.fetchTransactions(BTC_ADDR, BITCOIN, BTC, 1)).transactions).toHaveLength(1);
    rows = 0;
    expect((await btcAdapter.fetchTransactions(BTC_ADDR, BITCOIN, BTC, 1)).transactions).toHaveLength(2);
    expect(proxyCalls).toEqual(["bitcoin/history"]);
  });

  test("BCH: Blockchair down -> recorded (empty) proxy history", async () => {
    mockFetch(httpError(430), () => json(bitcoincashHistory));
    expect(await bchAdapter.fetchTransactions(BCH_ADDR, BITCOIN_CASH, coin("BCH"), 1)).toEqual({ transactions: [], hasMore: false });
    expect(proxyCalls).toEqual(["bitcoincash/history"]);
  });

  test("malformed rows make the whole answer unreadable", () => {
    expect(parseUtxoHistory({ transactions: [{ txid: "zz", received: "1", sent: "0" }] }, BTC_ADDR)).toBeNull();
    expect(parseUtxoHistory({ transactions: [{ txid: "aa".repeat(32), received: "1.5", sent: "0" }] }, BTC_ADDR)).toBeNull();
  });
});

describe("UTXOs for sends", () => {
  test("public ok: no proxy call", async () => {
    mockFetch(() => json([]), () => json({}, 500));
    expect(await utxosWithProxyFallback(BITCOIN, BTC_ADDR, async () => [])).toEqual([]);
    expect(proxyCalls).toEqual([]);
  });

  test("public read threw: Esplora-shaped list from the proxy", async () => {
    mockFetch(networkDown, () => json(bitcoinUtxos));
    const list = await utxosWithProxyFallback(BITCOIN, BTC_ADDR, async () => { throw new Error("Failed to fetch UTXOs: 503"); });
    expect(list).toEqual(bitcoinUtxos.utxos);
    expect(proxyCalls).toEqual(["bitcoin/utxos"]);
  });

  test("no usable proxy answer: the public error is rethrown (never an empty or partial list)", async () => {
    mockFetch(networkDown, () => json({ ...bitcoinUtxos, utxos: [...bitcoinUtxos.utxos, { txid: "x", vout: 0, value: 1, status: { confirmed: true } }] }));
    await expect(utxosWithProxyFallback(BITCOIN, BTC_ADDR, async () => { throw new Error("public down"); })).rejects.toThrow("public down");
    expect(await utxosWithProxyFallback(BITCOIN_TESTNET, BTC_ADDR, async () => [])).toEqual([]);
    await expect(utxosWithProxyFallback(BITCOIN_TESTNET, BTC_ADDR, async () => { throw new Error("testnet down"); })).rejects.toThrow("testnet down");
  });

  test("parseUtxoList rejects zero values and bad indexes", () => {
    const row = bitcoinUtxos.utxos[0];
    expect(parseUtxoList({ utxos: [{ ...row, value: 0 }] })).toBeNull();
    expect(parseUtxoList({ utxos: [{ ...row, vout: -1 }] })).toBeNull();
    expect(parseUtxoList({ utxos: [{ ...row, status: {} }] })).toBeNull();
    expect(parseUtxoList({ utxos: "x" })).toBeNull();
    expect(parseUtxoList({ ...bitcoinUtxos, truncated: true })).toBeNull();
    expect(parseUtxoList({ utxos: bitcoinUtxos.utxos })).toBeNull(); // no `truncated`: not known to be whole
  });
});

describe("fees and broadcast (Alchemy first on the server)", () => {
  const rates = { fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 };
  const RAW = "0200000001";
  const TXID = "07094d3bfb3f6d60fb60668366a0bc090d0b86059bf1210efb8a66c55b8a73b9";

  test("fees: public ok, no proxy; public down, the proxy's rates; BCH never asks", async () => {
    mockFetch(networkDown, () => json({ network: "bitcoin", source: "alchemy-btc", ...rates }));
    expect(await feesWithProxyFallback(BITCOIN, async () => ({ ...rates, fastestFee: 9 }))).toMatchObject({ fastestFee: 9 });
    expect(proxyCalls).toEqual([]);
    expect(await feesWithProxyFallback(LITECOIN, async () => { throw new Error("down"); })).toEqual(rates);
    expect(proxyCalls).toEqual(["litecoin/fees"]);
    await expect(feesWithProxyFallback(BITCOIN_CASH, async () => { throw new Error("bch down"); })).rejects.toThrow("bch down");
    expect(proxyCalls).toEqual(["litecoin/fees"]);
  });

  test("fees: a malformed proxy answer rethrows the public error", async () => {
    mockFetch(networkDown, () => json({ ...rates, hourFee: "x" }));
    await expect(feesWithProxyFallback(BITCOIN, async () => { throw new Error("public down"); })).rejects.toThrow("public down");
  });

  test("broadcast: public failed, the proxy relays the same bytes for the sending address", async () => {
    let sent: unknown = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      proxyCalls.push(String(input).replace(/^.*\/api\/chain\//, ""));
      sent = JSON.parse(String(init?.body));
      return json({ network: "bitcoin", address: BTC_ADDR, source: "alchemy-btc", txid: TXID });
    }) as typeof fetch;
    expect(await broadcastWithProxyFallback(BITCOIN, BTC_ADDR, RAW, async () => { throw new Error("Broadcast failed: 503"); })).toBe(TXID);
    expect(proxyCalls).toEqual(["bitcoin/broadcast"]);
    expect(sent).toEqual({ address: BTC_ADDR, rawTx: RAW });
  });

  test("broadcast: a node rejection through the proxy is reported; other proxy failures rethrow the public error", async () => {
    mockFetch(networkDown, () => json({ error: "Rejected", reason: "min relay fee not met" }, 422));
    await expect(broadcastWithProxyFallback(LITECOIN, LTC_ADDR, RAW, async () => { throw new Error("public"); })).rejects.toThrow("min relay fee not met");
    mockFetch(networkDown, () => json({ error: "x", fallback: "public" }, 502));
    await expect(broadcastWithProxyFallback(BITCOIN, BTC_ADDR, RAW, async () => { throw new Error("public"); })).rejects.toThrow("public");
    expect(proxyNetwork(BITCOIN)).toBeNull(); // paused after the 502
  });
});
