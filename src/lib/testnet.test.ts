import { describe, expect, test } from "bun:test";
import staticConfig from "../config.json";
import { isTestnetChain, testnetLabel } from "./testnet";
import { isChainVisible } from "./displayPrefs";

describe("test networks", () => {
  test("every test chain in config.json is one, no mainnet is", () => {
    const test = staticConfig.chains.filter((c) => isTestnetChain(c.name)).map((c) => c.name);
    expect(test.sort()).toEqual([
      "ALGORAND_TESTNET", "BASE_SEPOLIA", "BITCOIN_TESTNET", "CARDANO_PREPROD", "ETHEREUM_SEPOLIA", "LITECOIN_TESTNET",
      "RIPPLE_TESTNET", "SOLANA_DEVNET", "SOLANA_TESTNET", "STELLAR_TESTNET", "TON_TESTNET", "TRON_NILE_TESTNET", "TRON_SHASTA_TESTNET",
    ]);
  });
  test("badge text", () => {
    expect(testnetLabel("SOLANA_DEVNET")).toBe("devnet");
    expect(testnetLabel("CARDANO_PREPROD")).toBe("testnet");
    expect(testnetLabel("ETHEREUM")).toBeNull();
  });
  test("test networks show by default once listed; Manage display can still hide them", () => {
    expect(isChainVisible("ETHEREUM_SEPOLIA", null, ["ETHEREUM"])).toBe(true);
    expect(isChainVisible("BASE", null, ["ETHEREUM"])).toBe(false);
    expect(isChainVisible("ETHEREUM_SEPOLIA", { "chain:ETHEREUM_SEPOLIA": false }, ["ETHEREUM"])).toBe(false);
  });
});
