import { describe, expect, test, afterEach } from "bun:test";
import { waitForReceipt, fetchReceiptOnce } from "./evmTx";
import { evmReceiptRpcUrls } from "./evm-read-rpc-fallbacks";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

type Handler = (url: string) => Response | Promise<Response>;
function mockFetch(h: Handler) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return h(url);
  }) as typeof fetch;
  return calls;
}
const rpcOk = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
const forbidden = () => new Response("Archive requests require a personal token", { status: 403 });
const HASH = "0xabc";

describe("fetchReceiptOnce / waitForReceipt RPC rotation", () => {
  test("403 on RPC1 rotates to RPC2 and returns its receipt", async () => {
    const calls = mockFetch((u) => u === "https://rpc1" ? forbidden() : rpcOk({ status: "0x1", blockNumber: "0x10" }));
    const r = await waitForReceipt(["https://rpc1", "https://rpc2"], HASH, undefined, 3, 1);
    expect(r).toEqual({ status: "success", blockNumber: "0x10" });
    expect(calls).toEqual(["https://rpc1", "https://rpc2"]);
  });

  test("sticks to the working RPC on later polls", async () => {
    let n = 0;
    const calls = mockFetch((u) => {
      if (u === "https://rpc1") return forbidden();
      return rpcOk(++n < 2 ? null : { status: "0x1", blockNumber: "0x1" });
    });
    await waitForReceipt(["https://rpc1", "https://rpc2"], HASH, undefined, 5, 1);
    expect(calls).toEqual(["https://rpc1", "https://rpc2", "https://rpc2"]);
  });

  test("JSON-RPC error and non-JSON body also rotate", async () => {
    mockFetch((u) =>
      u === "https://a" ? new Response(JSON.stringify({ error: { message: "nope" } }), { status: 200 })
      : u === "https://b" ? new Response("<html>", { status: 200 })
      : rpcOk({ status: "0x1", blockNumber: "0x2" }));
    const { receipt, rpcIdx } = await fetchReceiptOnce(["https://a", "https://b", "https://c"], HASH);
    expect(receipt?.status).toBe("success");
    expect(rpcIdx).toBe(2);
  });

  test("on-chain revert (0x0) is reported failed", async () => {
    mockFetch(() => rpcOk({ status: "0x0", blockNumber: "0x3" }));
    expect((await waitForReceipt("https://rpc", HASH, undefined, 2, 1)).status).toBe("failed");
  });
});

describe("RPC errors are never a failed tx", () => {
  test("all RPCs erroring throws instead of returning status failed", async () => {
    mockFetch(() => forbidden());
    await expect(waitForReceipt(["https://a", "https://b"], HASH, undefined, 10, 1)).rejects.toThrow();
    await expect(fetchReceiptOnce(["https://a", "https://b"], HASH)).rejects.toThrow();
  });

  test("transient total outage after an earlier answer keeps polling until receipt", async () => {
    let n = 0;
    mockFetch(() => {
      n++;
      if (n === 1) return rpcOk(null);
      if (n <= 8) return forbidden();
      return rpcOk({ status: "0x1", blockNumber: "0x9" });
    });
    const r = await waitForReceipt(["https://a"], HASH, undefined, 20, 1);
    expect(r.status).toBe("success");
  });

  test("no receipt yet is null, not failed", async () => {
    mockFetch(() => rpcOk(null));
    expect((await fetchReceiptOnce(["https://a"], HASH)).receipt).toBeNull();
  });
});

describe("receipt validation", () => {
  test("receipt for a different tx hash is ignored (rotates)", async () => {
    mockFetch((u) => u === "https://a"
      ? rpcOk({ status: "0x1", blockNumber: "0x1", transactionHash: "0xother" })
      : rpcOk({ status: "0x1", blockNumber: "0x2", transactionHash: "0xABC" }));
    const r = await fetchReceiptOnce(["https://a", "https://b"], HASH);
    expect(r.rpcIdx).toBe(1);
    expect(r.receipt?.blockNumber).toBe("0x2");
  });

  test("failed verdict from a fallback alone is not accepted", async () => {
    mockFetch((u) => u === "https://a" ? forbidden() : rpcOk({ status: "0x0", blockNumber: "0x1" }));
    // b says failed, but the only other RPC (a) cannot confirm -> stays pending
    expect((await fetchReceiptOnce(["https://a", "https://b"], HASH)).receipt).toBeNull();
  });

  test("failed verdict from a fallback is accepted when another RPC agrees", async () => {
    mockFetch(() => rpcOk({ status: "0x0", blockNumber: "0x1" }));
    expect((await fetchReceiptOnce(["https://a", "https://b"], HASH, 1)).receipt?.status).toBe("failed");
  });

  test("JSON-RPC error body on HTTP 400 keeps its message", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: "nonce too low" } }), { status: 400 }));
    await expect(fetchReceiptOnce(["https://a"], HASH)).rejects.toThrow("nonce too low");
  });
});

describe("evmReceiptRpcUrls", () => {
  test("chain.rpcUrl first, then fallbacks, deduped; unknown chain only its own", () => {
    expect(evmReceiptRpcUrls({ rpcUrl: "https://x", evmChainId: 8453 })).toEqual(
      ["https://x", "https://mainnet.base.org", "https://base.drpc.org"]);
    expect(evmReceiptRpcUrls({ rpcUrl: "https://mainnet.base.org", evmChainId: 8453 })[0]).toBe("https://mainnet.base.org");
    expect(new Set(evmReceiptRpcUrls({ rpcUrl: "https://mainnet.base.org", evmChainId: 8453 })).size).toBe(2);
    expect(evmReceiptRpcUrls({ rpcUrl: "https://x", evmChainId: 999999 })).toEqual(["https://x"]);
    expect(evmReceiptRpcUrls({ rpcUrl: "https://x", evmChainId: null })).toEqual(["https://x"]);
  });
});
