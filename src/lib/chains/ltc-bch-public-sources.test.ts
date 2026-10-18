// Web reads LTC from Blockbook before litecoinspace and BCH from Haskoin before Blockchair (the iOS order).
// Fixtures in fixtures/public are recorded from the live sources (2026-10-18; see api/src/chain-proxy/fixtures/utxo).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Asset, Chain } from "../../shared/types";
import bbLtcAddress from "./fixtures/public/blockbook-ltc-address.json";
import hkTxs from "./fixtures/public/haskoin-bch-txs.json";
import hkUnspent from "./fixtures/public/haskoin-bch-unspent.json";
import hkBalance from "./fixtures/public/haskoin-bch-balance.json";

const g = globalThis as Record<string, unknown>;
const session = new Map<string, string>();
const mem = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
g.sessionStorage ??= mem;
g.localStorage ??= mem;
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };

const { ltcAdapter } = await import("./ltcAdapter");
const { bchAdapter } = await import("./bchAdapter");
const { fetchUtxos: fetchBchUtxos } = await import("./bchTx");
const { resetChainProxyState } = await import("./chain-proxy-client");

const LTC_ADDR = "ltc1qmntmcqz3qg26n4harn8vhhz4srgnpuftqmq7a0";
const BCH_ADDR = "bitcoincash:qpf6au3lwzd86mf4ctqyaselympk67dppu975n3g88";
const BCH_UTXO_ADDR = "bitcoincash:qrkycn7840apd3cxpwnyqdgvt7uskymjgyvj9wv3z9";
const chain = (name: string, type: "ltc" | "bch", explorerUrl: string, rpcUrl = ""): Chain => ({
  id: name.toLowerCase(), name, displayName: name, type, coinType: 0, evmChainId: null, rpcUrl, explorerUrl, iconUrl: null,
});
const LITECOIN = chain("LITECOIN", "ltc", "https://litecoinspace.org");
const BITCOIN_CASH = chain("BITCOIN_CASH", "bch", "https://blockchair.com/bitcoin-cash", "https://api.blockchair.com/bitcoin-cash");
const coin = (symbol: string): Asset => ({ id: symbol.toLowerCase(), symbol, name: symbol, decimals: 8, contractAddress: null, isNative: true, iconUrl: null, chainId: "x" });

const realFetch = globalThis.fetch;
let hosts: string[] = [];
let respond: (u: URL) => Response;
beforeEach(() => {
  hosts = [];
  resetChainProxyState();
  (globalThis.sessionStorage as Storage).removeItem("secretkey_token"); // no proxy: public sources only
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    hosts.push(u.host);
    return respond(u);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("LTC history: Blockbook first", () => {
  test("rows from Blockbook with server paging; litecoinspace is never asked", async () => {
    respond = () => Response.json(bbLtcAddress);
    const page = await ltcAdapter.fetchTransactions(LTC_ADDR, LITECOIN, coin("LTC"), 1);
    expect(hosts).toEqual(["litecoinblockexplorer.net"]);
    expect(page.hasMore).toBe(false);
    expect(page.transactions).toEqual([{
      hash: "a6bb0e121e65f1f5f0f4b0cc69d5688a99e9dc5010e21a7170c72b761207a2b5", from: "MPHfqjvdTjcz6xobjPoqKDjSkA2vsoHMBT", to: LTC_ADDR,
      value: "61847900", formatted: "0.618479", symbol: "LTC", timestamp: 1792309314, direction: "in", confirmed: true,
    }]);
  });

  test("Blockbook down: Esplora as before", async () => {
    respond = (u) => (u.host === "litecoinblockexplorer.net" ? new Response("down", { status: 503 }) : Response.json([]));
    expect(await ltcAdapter.fetchTransactions(LTC_ADDR, LITECOIN, coin("LTC"), 1)).toEqual({ transactions: [], hasMore: false });
    expect(hosts).toEqual(["litecoinblockexplorer.net", "litecoinspace.org"]);
  });
});

describe("malformed or cut answers fall back instead of reading as zero", () => {
  test("a tx without legs, or a full UTXO page, is not used", async () => {
    respond = (u) => (u.host === "litecoinblockexplorer.net"
      ? Response.json({ ...bbLtcAddress, transactions: [{ ...bbLtcAddress.transactions[0], vout: undefined }] }) : Response.json([]));
    await ltcAdapter.fetchTransactions(LTC_ADDR, LITECOIN, coin("LTC"), 1);
    expect(hosts).toEqual(["litecoinblockexplorer.net", "litecoinspace.org"]);
    hosts = [];
    respond = (u) => (u.host === "api.blockchair.com" ? Response.json({ data: { [BCH_UTXO_ADDR]: { utxo: [] } } })
      : Response.json(Array.from({ length: 1000 }, (_, i) => ({ ...hkUnspent[0], index: i }))));
    expect(await fetchBchUtxos(BCH_UTXO_ADDR)).toEqual([]);
    expect(hosts).toEqual(["api.haskoin.com", "api.blockchair.com"]);
  });
});

describe("BCH: Haskoin first", () => {
  test("balance from Haskoin, Blockchair not asked", async () => {
    respond = () => Response.json({ ...hkBalance, confirmed: 5000 });
    expect((await bchAdapter.fetchNativeBalance(BCH_ADDR, BITCOIN_CASH, coin("BCH")))?.balance).toBe("5000");
    expect(hosts).toEqual(["api.haskoin.com"]);
  });

  test("history rows from Haskoin match the address with or without the CashAddr prefix", async () => {
    respond = () => Response.json(hkTxs);
    const page = await bchAdapter.fetchTransactions(BCH_ADDR.replace("bitcoincash:", ""), BITCOIN_CASH, coin("BCH"), 1);
    expect(page.transactions.map((t) => [t.hash.slice(0, 12), t.direction, t.value])).toEqual([
      ["0172a7189e41", "out", "457672"], ["458de24f390d", "in", "457672"]]);
    expect(page.hasMore).toBe(false);
  });

  test("both Haskoin mirrors down: Blockchair, as before", async () => {
    respond = (u) => (u.host === "api.blockchair.com" ? Response.json({ data: { [BCH_ADDR]: { address: { balance: 7 } } } }) : new Response("down", { status: 502 }));
    expect((await bchAdapter.fetchNativeBalance(BCH_ADDR, BITCOIN_CASH, coin("BCH")))?.balance).toBe("7");
    expect(hosts).toEqual(["api.haskoin.com", "api.blockchain.info", "api.blockchair.com"]);
  });

  test("UTXOs for sends from Haskoin in Esplora shape; a malformed row falls back to Blockchair", async () => {
    respond = () => Response.json(hkUnspent);
    expect(await fetchBchUtxos(BCH_UTXO_ADDR)).toEqual([{ txid: "14e50d568f4ad93892d2e829a658c1f1dcb045c19beb68814162ff0f642a0d07",
      vout: 0, value: 184409, status: { confirmed: true, block_height: 973382 } }]);
    hosts = [];
    respond = (u) => (u.host === "api.blockchair.com" ? Response.json({ data: { [BCH_UTXO_ADDR]: { utxo: [] } } }) : Response.json([{ ...hkUnspent[0], value: -1 }]));
    expect(await fetchBchUtxos(BCH_UTXO_ADDR)).toEqual([]);
    expect(hosts).toEqual(["api.haskoin.com", "api.blockchair.com"]);
  });
});
