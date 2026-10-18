import { afterEach, describe, expect, test } from "bun:test";
import { revokeOriginTokens } from "./approval-labels";
import { decodeString } from "../tokenMetadata";
import { revokeCalldata, stateCalldata } from "./calldata";
import { parseProxyApprovals } from "./proxy-approvals";
import { APPROVAL_FOR_ALL_TOPIC, APPROVAL_TOPIC, fetchPublicApprovals, latestGrants, parseGrantLog } from "./public-approvals";
import { isUnlimited, UNLIMITED_ALLOWANCE, type Approval } from "./types";

const OWNER = "0x" + "11".repeat(20);
const SPENDER = "0x" + "ab".repeat(20);
const TOKEN = "0x" + "cd".repeat(20);
const pad = (a: string) => "0x" + a.replace(/^0x/, "").padStart(64, "0");
const TX = "0x" + "9".repeat(64);

describe("revoke calldata", () => {
  test("approve(spender, 0)", () => {
    expect(revokeCalldata({ kind: "erc20", spender: SPENDER })).toBe("0x095ea7b3" + pad(SPENDER).slice(2) + "0".repeat(64));
  });
  test("setApprovalForAll(operator, false)", () => {
    expect(revokeCalldata({ kind: "nft_all", spender: SPENDER })).toBe("0xa22cb465" + pad(SPENDER).slice(2) + "0".repeat(64));
  });
  test("state reads", () => {
    expect(stateCalldata("erc20", OWNER, SPENDER)).toBe("0xdd62ed3e" + pad(OWNER).slice(2) + pad(SPENDER).slice(2));
    expect(stateCalldata("nft_all", OWNER, SPENDER).slice(0, 10)).toBe("0xe985e9c5");
  });
});

describe("unlimited", () => {
  const a = (allowance: bigint | null): Approval => ({ kind: "erc20", contract: TOKEN, spender: SPENDER, allowance, block: 1, txHash: TX, timestamp: null, flagged: false });
  test("threshold 2^128", () => {
    expect(isUnlimited(a(UNLIMITED_ALLOWANCE))).toBe(true);
    expect(isUnlimited(a(UNLIMITED_ALLOWANCE - 1n))).toBe(false);
    expect(isUnlimited(a(null))).toBe(false);
  });
});

describe("proxy answer validation", () => {
  const good = { kind: "erc20", contract: TOKEN, spender: SPENDER, allowance: "0x64", block: 10, txHash: TX, timestamp: 1_700_000_000, flagged: true };
  test("keeps valid rows and drops malformed ones", () => {
    const res = parseProxyApprovals({
      network: "ethereum", address: OWNER, truncated: true,
      approvals: [
        good,
        { ...good, kind: "nft_all", allowance: null, timestamp: null, flagged: false },
        { ...good, contract: "0x1234" },
        { ...good, spender: 5 },
        { ...good, allowance: null },
        { ...good, allowance: "0x0" },
        { ...good, allowance: "nope" },
        { ...good, kind: "erc721" },
        { ...good, block: -1 },
        { ...good, txHash: "0x12" },
        { ...good, flagged: "yes" },
        { ...good, timestamp: "soon" },
        { ...good, kind: "nft_all", allowance: "0x1" },
        null,
        "row",
      ],
    })!;
    expect(res.truncated).toBe(true);
    expect(res.partial).toBe(false);
    expect(res.approvals.map((x) => x.kind)).toEqual(["erc20", "nft_all"]);
    expect(res.approvals[0]).toMatchObject({ allowance: 100n, flagged: true, timestamp: 1_700_000_000 });
  });
  test("not an approvals answer", () => {
    expect(parseProxyApprovals(null)).toBeNull();
    expect(parseProxyApprovals({ approvals: "x" })).toBeNull();
  });
});

describe("public fallback", () => {
  const log = (over: Record<string, unknown>) => ({
    address: TOKEN, topics: [APPROVAL_TOPIC, pad(OWNER), pad(SPENDER)], data: pad("0x5"), blockNumber: "0xa", logIndex: "0x0", transactionHash: TX, ...over,
  });
  test("4-topic ERC-721 Approval is skipped", () => {
    expect(parseGrantLog("erc20", log({ topics: [APPROVAL_TOPIC, pad(OWNER), pad(SPENDER), pad("0x1")] }))).toBeNull();
    expect(parseGrantLog("erc20", log({}))).toMatchObject({ contract: TOKEN, spender: SPENDER, on: true });
  });
  test("ApprovalForAll reads the flag from data", () => {
    const t = [APPROVAL_FOR_ALL_TOPIC, pad(OWNER), pad(SPENDER)];
    expect(parseGrantLog("nft_all", log({ topics: t, data: pad("0x1") }))?.on).toBe(true);
    expect(parseGrantLog("nft_all", log({ topics: t, data: pad("0x0") }))?.on).toBe(false);
  });
  test("latest grant per pair wins", () => {
    const g = (block: number, logIndex: number, on: boolean) => ({ kind: "nft_all" as const, contract: TOKEN, spender: SPENDER, block, logIndex, txHash: TX, on });
    const res = latestGrants([g(20, 1, false), g(10, 0, true), g(20, 0, true)]);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ block: 20, logIndex: 1, on: false });
  });

  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test("end to end: chunks the window, drops revoked and unreadable rows, marks partial", async () => {
    const calls: string[] = [];
    const other = "0x" + "ee".repeat(20);
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body);
      calls.push(method);
      let result: unknown;
      if (method === "eth_blockNumber") result = "0x186a0"; // 100000
      else if (method === "eth_getLogs") {
        const f = params[0];
        const first = f.fromBlock === "0x" + (100_000 - 50_000 + 1).toString(16);
        if (f.topics[0] === APPROVAL_TOPIC) {
          result = first ? [
            log({ blockNumber: "0xc351", data: pad("0x1") }),
            log({ blockNumber: "0xc352", data: pad("0x0") }), // later grant of the same pair wins
            log({ address: other, blockNumber: "0xc353" }),
            log({ address: TOKEN, topics: [APPROVAL_TOPIC, pad(OWNER), pad(SPENDER), pad("0x1")], blockNumber: "0xc354" }),
          ] : [];
        } else result = [];
      } else if (method === "eth_call") {
        result = params[0].to === other ? pad("0x7") : pad("0x0");
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }) as unknown as typeof fetch;
    const res = await fetchPublicApprovals("http://rpc", OWNER);
    expect(calls.filter((m) => m === "eth_getLogs")).toHaveLength(10); // 5 chunks x 2 events
    expect(res.partial).toBe(true);
    expect(res.approvals).toHaveLength(1);
    expect(res.approvals[0]).toMatchObject({ contract: other, spender: SPENDER, allowance: 7n, flagged: false, timestamp: null });
  });
});

describe("revoke origin tokens and name decoding", () => {
  test("only a token whose decimals answered is vouched for in the revoke review", () => {
    // Unknown decimals (an NFT, or unreadable): never vouched for as a fungible token.
    expect(revokeOriginTokens(TOKEN, { symbol: "BAYC", name: "Bored Apes", decimals: null })).toEqual([]);
    expect(revokeOriginTokens(TOKEN)).toEqual([]);
    expect(revokeOriginTokens(TOKEN, { symbol: "USDC", name: "USD Coin", decimals: 6 })[0].decimals).toBe(6);
  });
  test("decodeString reads ABI string and bytes32 forms", () => {
    const hex = (s: string) => Buffer.from(s).toString("hex");
    const abi = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + hex("Punk").padEnd(64, "0");
    expect(decodeString(abi)).toBe("Punk");
    expect(decodeString("0x" + hex("MKR").padEnd(64, "0"))).toBe("MKR");
  });
});
