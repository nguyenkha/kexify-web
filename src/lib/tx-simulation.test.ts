// Free balance-change simulation. Fixtures were recorded on 2026-10-18 from the default public RPCs in config.json:
// eth_simulateV1 (traceTransfers) on ethereum-rpc.publicnode.com for a 0.01 ETH send, a 1 USDC transfer and a
// USDC transfer above the balance (revert); simulateTransaction + getMultipleAccounts on solana-rpc.publicnode.com
// for a 0.01 SOL send, a 1 USDT transfer and a USDT transfer above the balance (InstructionError).
import { afterEach, describe, expect, test } from "bun:test";
import evmNative from "./fixtures/tx-simulation/eth-simulate-v1-native.json";
import evmErc20 from "./fixtures/tx-simulation/eth-simulate-v1-erc20.json";
import evmRevert from "./fixtures/tx-simulation/eth-simulate-v1-revert.json";
import solTransfer from "./fixtures/tx-simulation/solana-simulate-sol-transfer.json";
import splTransfer from "./fixtures/tx-simulation/solana-simulate-spl-transfer.json";
import splFail from "./fixtures/tx-simulation/solana-simulate-spl-insufficient.json";
import { parseEthSimulateV1, formatBaseUnits, decodeAbiString } from "./tx-simulation-evm-parse";
import { parseSolanaSimulation, writableStaticKeys, parseWireAccounts, simulateSolanaTransaction, type SolParsedAccount } from "./tx-simulation-solana";
import { base58 } from "@scure/base";
import { simulateEvmTransaction } from "./txSimulation";

const FROM = "0x28C6c06298d514Db089934071355E5743bf21d60";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT_SPL = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Answer JSON-RPC by method; anything else is a "method not found" error. */
function mockRpc(handlers: Record<string, (params: unknown[]) => unknown>) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const h = handlers[method];
    const body = h ? { jsonrpc: "2.0", id: 1, result: h(params) } : { jsonrpc: "2.0", id: 1, error: { code: -32601, message: `the method ${method} does not exist` } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("parseEthSimulateV1 (recorded)", () => {
  test("native send: one negative native delta", () => {
    const r = parseEthSimulateV1(evmNative, FROM);
    expect(r).toEqual({ reverted: false, deltas: [{ contractAddress: null, delta: -10_000_000_000_000_000n }] });
  });

  test("ERC-20 transfer: token delta, no native delta (gas is not a transfer)", () => {
    const r = parseEthSimulateV1(evmErc20, FROM);
    expect(r).toEqual({ reverted: false, deltas: [{ contractAddress: USDC, delta: -1_000_000n }] });
  });

  test("revert: flagged, no deltas", () => {
    expect(parseEthSimulateV1(evmRevert, FROM)).toEqual({ reverted: true, deltas: [] });
  });

  test("other parties' transfers are ignored and round trips net out", () => {
    const r = parseEthSimulateV1(evmNative, "0x2222222222222222222222222222222222222222");
    expect(r.deltas).toEqual([]);
    const call = (evmErc20 as { calls: { logs: { topics: string[] }[] }[] }[])[0].calls[0];
    const back = { ...call.logs[0], topics: [call.logs[0].topics[0], call.logs[0].topics[2], call.logs[0].topics[1]] };
    const both = [{ calls: [{ ...call, logs: [call.logs[0], back] }] }];
    expect(parseEthSimulateV1(both, FROM).deltas).toEqual([]);
  });

  test("garbage input yields nothing", () => {
    expect(parseEthSimulateV1(null, FROM)).toEqual({ reverted: false, deltas: [] });
    expect(parseEthSimulateV1({ foo: 1 }, FROM)).toEqual({ reverted: false, deltas: [] });
  });
});

describe("helpers", () => {
  test("formatBaseUnits", () => {
    expect(formatBaseUnits(1_000_000n, 6)).toBe("1");
    expect(formatBaseUnits(-10_005_000n, 9)).toBe("0.010005");
    expect(formatBaseUnits(42n, 0)).toBe("42");
  });

  test("decodeAbiString: ABI string and bytes32", () => {
    const abi = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + "55534443".padEnd(64, "0");
    expect(decodeAbiString(abi)).toBe("USDC");
    expect(decodeAbiString("0x" + "4d4b52".padEnd(64, "0"))).toBe("MKR");
    expect(decodeAbiString("0x")).toBeNull();
  });
});

describe("simulateEvmTransaction", () => {
  test("any RPC: eth_simulateV1 with known token metadata", async () => {
    mockRpc({ eth_simulateV1: () => evmErc20 });
    const r = await simulateEvmTransaction("https://ethereum-rpc.publicnode.com", { from: FROM, to: USDC, data: "0xa9059cbb" }, {
      knownTokens: [{ contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", decimals: 6 }],
    });
    expect(r?.provider).toBe("rpc");
    expect(r?.feeIncluded).toBe(false);
    expect(r?.changes).toEqual([{
      asset: { symbol: "USDC", contractAddress: USDC, decimals: 6, known: true },
      amount: "1", rawAmount: "1000000", direction: "out",
    }]);
  });

  test("unknown token: metadata read from the contract and marked not known", async () => {
    mockRpc({
      eth_simulateV1: () => evmErc20,
      eth_call: (p) => ((p[0] as { data: string }).data === "0x313ce567"
        ? "0x" + "6".padStart(64, "0")
        : "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + "55534443".padEnd(64, "0")),
    });
    const r = await simulateEvmTransaction("https://rpc.example", { from: FROM, to: USDC });
    expect(r?.changes[0].asset).toEqual({ symbol: "USDC", contractAddress: USDC, decimals: 6, known: false });
    expect(r?.changes[0].amount).toBe("1");
  });

  test("native symbol comes from the chain", async () => {
    mockRpc({ eth_simulateV1: () => evmNative });
    const r = await simulateEvmTransaction("https://bsc-dataseed1.binance.org", { from: FROM, to: FROM }, { nativeSymbol: "BNB" });
    expect(r?.changes).toEqual([{ asset: { symbol: "BNB", contractAddress: null, decimals: 18, known: true }, amount: "0.01", rawAmount: "10000000000000000", direction: "out" }]);
  });

  test("Alchemy: a contract calling itself USDC is not known (not priced) unless it is in the app's list", async () => {
    const fake = "0x9999999999999999999999999999999999999999";
    mockRpc({ alchemy_simulateAssetChanges: () => ({ changes: [
      { assetType: "ERC20", from: FROM, to: "0x1", rawAmount: "1000000", contractAddress: fake, decimals: 6, symbol: "USDC", name: "USDC", amount: "1" },
      { assetType: "NATIVE", from: FROM, to: "0x1", rawAmount: "1", decimals: 18, symbol: "ETH", name: "Ether", amount: "0.000000000000000001" },
    ] }) });
    const r = await simulateEvmTransaction("https://eth-mainnet.g.alchemy.com/v2/x", { from: FROM, to: fake }, {
      knownTokens: [{ contractAddress: USDC, symbol: "USDC", decimals: 6 }],
    });
    expect(r?.changes.map((c) => c.asset.known)).toEqual([false, true]);
  });

  test("revert is reported, not thrown", async () => {
    mockRpc({ eth_simulateV1: () => evmRevert });
    const r = await simulateEvmTransaction("https://rpc.example", { from: FROM, to: USDC });
    expect(r).toEqual({ changes: [], provider: "rpc", reverted: true });
  });

  test("node without eth_simulateV1, HTTP error or network error: null (static estimate stays)", async () => {
    mockRpc({});
    expect(await simulateEvmTransaction("https://rpc.example", { from: FROM, to: USDC })).toBeNull();
    globalThis.fetch = (async () => new Response("bad", { status: 502 })) as unknown as typeof fetch;
    expect(await simulateEvmTransaction("https://rpc.example", { from: FROM, to: USDC })).toBeNull();
    globalThis.fetch = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await simulateEvmTransaction("https://rpc.example", { from: FROM, to: USDC })).toBeNull();
  });
});

type SolFixture = { owner: string; txBase64: string; addresses: string[]; pre: (SolParsedAccount | null)[]; simulation: { err: unknown; accounts: (SolParsedAccount | null)[] } };
const wire = (f: SolFixture) => Uint8Array.from(atob(f.txBase64), (c) => c.charCodeAt(0));

describe("Solana simulateTransaction (recorded)", () => {
  test("writable static keys match what was recorded", () => {
    for (const f of [solTransfer, splTransfer] as SolFixture[]) {
      expect(writableStaticKeys(wire(f))).toEqual(f.addresses);
    }
  });

  test("SOL send: amount + 5000 lamport fee", () => {
    const f = solTransfer as SolFixture;
    expect(parseSolanaSimulation(f.addresses, f.pre, f.simulation.accounts, f.owner)).toEqual([
      { mint: null, decimals: 9, delta: -10_005_000n },
    ]);
  });

  test("SPL send: fee in SOL plus the token delta of the owner's account only", () => {
    const f = splTransfer as SolFixture;
    expect(parseSolanaSimulation(f.addresses, f.pre, f.simulation.accounts, f.owner)).toEqual([
      { mint: null, decimals: 9, delta: -5000n },
      { mint: USDT_SPL, decimals: 6, delta: -1_000_000n },
    ]);
  });

  test("new and closed token accounts count in full", () => {
    const f = splTransfer as SolFixture;
    const [, tokenAcc] = f.simulation.accounts;
    expect(parseSolanaSimulation(["new"], [null], [tokenAcc], f.owner)).toEqual([{ mint: USDT_SPL, decimals: 6, delta: 336_971_270n }]);
    expect(parseSolanaSimulation(["gone"], [tokenAcc], [null], f.owner)).toEqual([{ mint: USDT_SPL, decimals: 6, delta: -336_971_270n }]);
  });

  test("simulateSolanaTransaction end to end on the recorded responses", async () => {
    const f = splTransfer as SolFixture;
    mockRpc({
      getMultipleAccounts: () => ({ context: { slot: 1 }, value: f.pre }),
      simulateTransaction: () => ({ context: { slot: 1 }, value: f.simulation }),
    });
    const r = await simulateSolanaTransaction("https://solana-rpc.publicnode.com", wire(f), f.owner, [
      { contractAddress: USDT_SPL, symbol: "USDT", decimals: 6 },
    ]);
    expect(r).toEqual({
      provider: "rpc",
      feeIncluded: true,
      changes: [
        { asset: { symbol: "SOL", contractAddress: null, decimals: 9, known: true }, amount: "0.000005", rawAmount: "5000", direction: "out" },
        { asset: { symbol: "USDT", contractAddress: USDT_SPL, decimals: 6, known: true }, amount: "1", rawAmount: "1000000", direction: "out" },
      ],
    });
  });

  test("failing tx is reported as reverted; RPC failure gives null", async () => {
    const f = splFail as SolFixture;
    mockRpc({
      getMultipleAccounts: () => ({ value: f.pre }),
      simulateTransaction: () => ({ value: f.simulation }),
    });
    expect(await simulateSolanaTransaction("https://x", wire(f), f.owner)).toEqual({ changes: [], provider: "rpc", reverted: true });
    mockRpc({});
    expect(await simulateSolanaTransaction("https://x", wire(f), f.owner)).toBeNull();
  });
});

describe("Solana v0 lookup tables", () => {
  // v0 message: owner (signer), 1 program key, blockhash, 1 ix, 1 lookup (writable [2], readonly [0])
  const owner = (splTransfer as SolFixture).owner;
  const table = "AddressLookupTab1e1111111111111111111111111";
  const prog = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const msg = new Uint8Array([
    0x80, 1, 0, 1, 2, ...base58.decode(owner), ...base58.decode(prog), ...new Uint8Array(32),
    1, 1, 2, 0, 2, 1, 0xaa,
    1, ...base58.decode(table), 1, 2, 1, 0,
  ]);
  const tx = new Uint8Array([1, ...new Uint8Array(64), ...msg]);
  const loaded = (splTransfer as SolFixture).addresses[1]; // owner's token account, reached only through the table

  test("parseWireAccounts reads static writable keys and lookup indexes", () => {
    expect(parseWireAccounts(tx)).toEqual({ keys: [owner], lookups: [{ table, writable: [2] }] });
  });

  test("lookup-table accounts are resolved and simulated", async () => {
    const f = splTransfer as SolFixture;
    const seen: string[][] = [];
    mockRpc({
      getMultipleAccounts: (p) => {
        const addrs = p[0] as string[];
        seen.push(addrs);
        if (addrs[0] === table) return { value: [{ data: { parsed: { info: { addresses: ["x", "y", loaded] } } } }] };
        return { value: [f.pre[0], f.pre[1]] };
      },
      simulateTransaction: () => ({ value: { err: null, accounts: [f.simulation.accounts[0], f.simulation.accounts[1]] } }),
    });
    const r = await simulateSolanaTransaction("https://x", tx, owner);
    expect(seen[1]).toEqual([owner, loaded]);
    expect(r?.changes.map((c) => [c.asset.contractAddress, c.direction, c.rawAmount])).toEqual([[null, "out", "5000"], [USDT_SPL, "out", "1000000"]]);
  });

  test("unreadable lookup table: could not simulate (null), never a partial result", async () => {
    mockRpc({ getMultipleAccounts: () => ({ value: [null] }) });
    expect(await simulateSolanaTransaction("https://x", tx, owner)).toBeNull();
  });
});
