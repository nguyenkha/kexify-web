// Chain proxy fallback for TON: toncenter first, the proxy only after it failed. Proxy answers are hand-made in the
// shape of api/src/chain-proxy/ton-reader.ts (route tests in api/src/chain-proxy-ton-route.test.ts).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Address, beginCell, external, storeMessage } from "@ton/core";
import type { Asset, Chain } from "../../shared/types";

const g = globalThis as Record<string, unknown>;
const session = new Map<string, string>();
const mem = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
g.sessionStorage ??= mem;
g.localStorage ??= mem;
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };

const { tonAdapter, publicKeyToTonAddress } = await import("./tonAdapter");
const { proxyNetwork, resetChainProxyState } = await import("./chain-proxy-client");
const { broadcastTonWithProxyFallback, tonSeqnoWithProxyFallback, jettonWalletWithProxyFallback, parseTonAccount } = await import("./chain-proxy-ton");
const { TonNodeRejected, tonMessageHash } = await import("./tonTx");
const { setRecoveryActive } = await import("../recovery-flag");
const { exitRecoveryMode } = await import("../recovery");

const ADDR = publicKeyToTonAddress("d75a980182b10ab7d54bfed3c964073a0ee172f3daa3f4a18446b7b8b55dc32a");
const RAW = Address.parse(ADDR).toRawString();
const OTHER = "EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2";
const MASTER_RAW = "0:" + "ab".repeat(32);
const MASTER = Address.parse(MASTER_RAW).toString();
const WALLET_RAW = "0:" + "cd".repeat(32);

const chain = (name: string): Chain => ({
  id: name.toLowerCase(), name, displayName: name, type: "ton", coinType: 607, evmChainId: null,
  rpcUrl: name === "TON" ? "https://toncenter.com/api/v2" : "https://testnet.toncenter.com/api/v2", explorerUrl: "", iconUrl: null,
});
const TON = chain("TON");
const TON_TESTNET = chain("TON_TESTNET");
const NATIVE: Asset = { id: "ton", symbol: "TON", name: "TON", decimals: 9, contractAddress: null, isNative: true, iconUrl: null, chainId: "ton" };
const USDT: Asset = { id: "usdt", symbol: "USDT", name: "Tether", decimals: 6, contractAddress: MASTER, isNative: false, iconUrl: null, chainId: "ton" };
const OTHER_JETTON: Asset = { ...USDT, id: "not", symbol: "NOT", contractAddress: Address.parse("0:" + "ef".repeat(32)).toString() };

const balanceAnswer = {
  network: "ton", address: RAW, balance: "2500000000", state: "active", seqno: 12,
  jettons: [{ master: MASTER_RAW, wallet: WALLET_RAW, balance: "7000000" }], jettonsTruncated: false,
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;
let proxyCalls: { path: string; body: Record<string, unknown> }[] = [];

function mockFetch(pub: Handler, proxy: Handler) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/chain/")) {
      proxyCalls.push({ path: url.replace(/^.*\/api\/chain\//, ""), body: JSON.parse(String(init?.body ?? "{}")) });
      return proxy(url, init);
    }
    return pub(url, init);
  }) as typeof fetch;
}
const networkDown: Handler = () => { throw new TypeError("Failed to fetch"); };
const httpError = (status: number): Handler => () => json({ ok: false, error: "nope" }, status);

beforeEach(() => {
  resetChainProxyState();
  proxyCalls = [];
  exitRecoveryMode();
  (globalThis.sessionStorage as Storage).setItem("secretkey_token", "test-jwt");
});
afterEach(() => { globalThis.fetch = realFetch; setRecoveryActive(false); });

describe("TON proxy network", () => {
  test("mainnet maps to `ton`; testnet and recovery mode are never proxied", () => {
    expect(proxyNetwork(TON)).toBe("ton");
    expect(proxyNetwork(TON_TESTNET)).toBeNull();
    setRecoveryActive(true);
    expect(proxyNetwork(TON)).toBeNull();
  });

  test("parseTonAccount refuses a malformed answer whole", () => {
    expect(parseTonAccount({ ...balanceAnswer, balance: "1.5" })).toBeNull();
    expect(parseTonAccount({ ...balanceAnswer, seqno: -1 })).toBeNull();
    expect(parseTonAccount({ ...balanceAnswer, jettons: [{ master: "x", wallet: WALLET_RAW, balance: "1" }] })).toBeNull();
    expect(parseTonAccount({ ...balanceAnswer, seqno: null })?.seqno).toBeNull();
  });
});

describe("balances", () => {
  test("toncenter ok: the proxy is never called", async () => {
    mockFetch(() => json({ ok: true, result: "42" }), () => json({}, 500));
    expect((await tonAdapter.fetchNativeBalance(ADDR, TON, NATIVE))?.balance).toBe("42");
    expect(proxyCalls).toEqual([]);
  });

  test("toncenter down: native and jettons from ONE proxy call, raw address sent", async () => {
    mockFetch(httpError(503), () => json(balanceAnswer));
    expect((await tonAdapter.fetchNativeBalance(ADDR, TON, NATIVE))?.formatted).toBe("2.5");
    const tokens = await tonAdapter.fetchTokenBalances(ADDR, TON, [USDT, OTHER_JETTON]);
    expect(tokens.map((t) => [t.asset.symbol, t.balance, t.formatted])).toEqual([["USDT", "7000000", "7"]]);
    expect(proxyCalls).toEqual([{ path: "ton/balance", body: { address: RAW } }]);
  });

  test("recovery mode: no server call, balance stays unreadable", async () => {
    setRecoveryActive(true);
    mockFetch(networkDown, () => json(balanceAnswer));
    expect(await tonAdapter.fetchNativeBalance(ADDR, TON, NATIVE)).toBeNull();
    expect(proxyCalls).toEqual([]);
  });

  test("an answer for another address is ignored; a refusal pauses the network", async () => {
    mockFetch(httpError(503), () => json({ ...balanceAnswer, address: Address.parse(OTHER).toRawString() }));
    expect(await tonAdapter.fetchNativeBalance(ADDR, TON, NATIVE)).toBeNull();
    resetChainProxyState();
    mockFetch(httpError(503), () => json({ error: "Too many requests", fallback: "public" }, 429));
    expect(await tonAdapter.fetchNativeBalance(ADDR, TON, NATIVE)).toBeNull();
    expect(proxyNetwork(TON)).toBeNull();
  });
});

describe("history", () => {
  test("toncenter down: native rows from the proxy with the adapter's rules", async () => {
    const tx = (hash: string, in_msg: unknown, out_msgs: unknown[]) => ({ transaction_id: { hash }, utime: 1760000000, fee: "1", in_msg, out_msgs });
    mockFetch(networkDown, () => json({ network: "ton", address: RAW, transactions: [
      tx("AAAA", { source: OTHER, destination: ADDR, value: "1500000000" }, []),
      tx("AAAB", { source: "", destination: ADDR, value: "0" }, [{ source: ADDR, destination: OTHER, value: "250000000" }]),
      tx("AAAC", { source: OTHER, destination: ADDR, value: "10" }, []), // dust
    ] }));
    const page = await tonAdapter.fetchTransactions(ADDR, TON, NATIVE, 1);
    expect(page.hasMore).toBe(false);
    expect(page.transactions.map((t) => [t.direction, t.value, t.formatted, t.hash])).toEqual([
      ["in", "1500000000", "1.5", "000000"],
      ["out", "250000000", "0.25", "000001"],
    ]);
    expect(proxyCalls).toEqual([{ path: "ton/history", body: { address: RAW } }]);
  });

  test("jetton history: proxy transfers by master, direction from the server's `out`", async () => {
    mockFetch(httpError(500), () => json({ network: "ton", address: RAW, jetton: MASTER_RAW, transfers: [
      { out: true, source: ADDR, destination: OTHER, amount: "1000000", transaction_hash: "AAAA", transaction_now: 1760000001 },
      { out: false, source: OTHER, destination: ADDR, amount: "2500000", transaction_hash: "AAAB", transaction_now: 1760000000 },
    ] }));
    const page = await tonAdapter.fetchTransactions(ADDR, TON, USDT, 1);
    expect(page.transactions.map((t) => [t.direction, t.formatted, t.symbol])).toEqual([["out", "1", "USDT"], ["in", "2.5", "USDT"]]);
    expect(proxyCalls[0].body).toEqual({ address: RAW, jetton: MASTER_RAW });
  });

  test("HTTP error without a proxy answer stays an empty page; page 2 never calls the proxy", async () => {
    mockFetch(httpError(503), () => json({ error: "x", fallback: "public" }, 502));
    expect(await tonAdapter.fetchTransactions(ADDR, TON, NATIVE, 1)).toEqual({ transactions: [], hasMore: false });
    resetChainProxyState();
    proxyCalls = [];
    expect(await tonAdapter.fetchTransactions(ADDR, TON, NATIVE, 2)).toEqual({ transactions: [], hasMore: false });
    expect(proxyCalls).toEqual([]);
  });
});

describe("send", () => {
  const boc = (to: string) => beginCell().store(storeMessage(external({ to: Address.parse(to), body: beginCell().storeUint(1, 32).endCell() })))
    .endCell().toBoc().toString("base64");

  test("broadcast: toncenter failed -> the proxy relays to the message's own wallet; hash = message hash", async () => {
    mockFetch(networkDown, () => json({ network: "ton", address: RAW, sent: true }));
    const signed = boc(ADDR);
    const hash = await broadcastTonWithProxyFallback(TON, signed, async () => { throw new Error("TON broadcast rate limited"); });
    expect(hash).toBe(tonMessageHash(signed));
    expect(proxyCalls).toEqual([{ path: "ton/broadcast", body: { address: RAW, boc: signed } }]);
  });

  test("broadcast: a toncenter rejection is final (no proxy); a proxy 422 reports the node's reason", async () => {
    mockFetch(networkDown, () => json({ error: "Rejected", reason: "cannot apply external message" }, 422));
    await expect(broadcastTonWithProxyFallback(TON, boc(ADDR), async () => { throw new TonNodeRejected("seqno"); })).rejects.toThrow("seqno");
    expect(proxyCalls).toEqual([]);
    await expect(broadcastTonWithProxyFallback(TON, boc(ADDR), async () => { throw new Error("TON broadcast rate limited. Please try again."); }))
      .rejects.toThrow("cannot apply external message");
    // The public send may have gone out (timeout / 5xx): a refused relay is neither success nor a plain failure.
    await expect(broadcastTonWithProxyFallback(TON, boc(ADDR), async () => { throw new Error("down"); })).rejects.toThrow("may have been sent");
  });

  test("broadcastTonTransaction: a toncenter 5xx outage is relayable, a node verdict is final", async () => {
    const { broadcastTonTransaction } = await import("./tonTx");
    mockFetch(() => json({ ok: false, error: "LITE_SERVER_NETWORK timeout", code: 503 }, 503), () => json({}, 500));
    const outage = await broadcastTonTransaction(TON.rpcUrl, boc(ADDR)).catch((e) => e);
    expect(outage).toBeInstanceOf(Error);
    expect(outage).not.toBeInstanceOf(TonNodeRejected);
    mockFetch(() => json({ ok: false, error: "LITE_SERVER_UNKNOWN: cannot apply external message to current state", code: 500 }, 500), () => json({}, 500));
    expect(await broadcastTonTransaction(TON.rpcUrl, boc(ADDR)).catch((e) => e)).toBeInstanceOf(TonNodeRejected);
  });

  test("seqno and jetton wallet fall back to the proxy's balance answer only when toncenter threw", async () => {
    mockFetch(networkDown, () => json(balanceAnswer));
    expect(await tonSeqnoWithProxyFallback(TON, ADDR, async () => 3)).toBe(3);
    expect(proxyCalls).toEqual([]);
    expect(await tonSeqnoWithProxyFallback(TON, ADDR, async () => { throw new Error("rate limited"); })).toBe(12);
    expect(await jettonWalletWithProxyFallback(TON, ADDR, MASTER, async () => { throw new Error("429"); })).toBe(WALLET_RAW);
    await expect(jettonWalletWithProxyFallback(TON, ADDR, OTHER_JETTON.contractAddress!, async () => { throw new Error("429"); })).rejects.toThrow("429");
    expect(proxyCalls.map((c) => c.path)).toEqual(["ton/balance", "ton/balance"]); // the seqno read is fresh, not the memo
  });

  test("seqno: an undeployed wallet (no seqno, not active) is 0; an active one without seqno is unreadable", async () => {
    mockFetch(networkDown, () => json({ ...balanceAnswer, seqno: null, state: "uninitialized" }));
    expect(await tonSeqnoWithProxyFallback(TON, ADDR, async () => { throw new Error("rate limited"); })).toBe(0);
    resetChainProxyState();
    mockFetch(networkDown, () => json({ ...balanceAnswer, seqno: null, state: "active" }));
    await expect(tonSeqnoWithProxyFallback(TON, ADDR, async () => { throw new Error("rate limited"); })).rejects.toThrow("rate limited");
  });
});
