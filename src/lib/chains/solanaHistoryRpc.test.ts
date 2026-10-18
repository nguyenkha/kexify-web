import { describe, expect, test } from "bun:test";
import { solanaHistoryRpcUrl } from "./solanaAdapter";

describe("solanaHistoryRpcUrl", () => {
  test("publicnode mainnet (no history) maps to mainnet-beta", () => {
    expect(solanaHistoryRpcUrl("https://solana-rpc.publicnode.com")).toBe("https://api.mainnet-beta.solana.com");
    expect(solanaHistoryRpcUrl("https://solana-rpc.publicnode.com/")).toBe("https://api.mainnet-beta.solana.com");
  });
  test("other RPCs are kept", () => {
    expect(solanaHistoryRpcUrl("https://api.devnet.solana.com")).toBe("https://api.devnet.solana.com");
  });
});
