import { afterEach, describe, expect, test } from "bun:test";
import { adaSlotAtTime, adaTipFromRosettaStatus } from "./ada-slot-from-time";
import { getAdaTip } from "./adaTx";

// Live tips read from Koios /tip on 2026-10-15 (block_time is unix seconds, abs_slot the real slot)
const MAINNET_TIP = { block_height: 14_071_951, block_time: 1_792_078_541, abs_slot: 200_512_250 };
const PREPROD_TIP = { block_height: 5_295_655, block_time: 1_792_078_510, abs_slot: 136_395_310 };

describe("adaSlotAtTime", () => {
  test("matches the real mainnet tip slot", () => {
    expect(adaSlotAtTime("mainnet", MAINNET_TIP.block_time * 1000)).toBe(MAINNET_TIP.abs_slot);
  });

  test("matches the real preprod tip slot", () => {
    expect(adaSlotAtTime("preprod", PREPROD_TIP.block_time * 1000)).toBe(PREPROD_TIP.abs_slot);
  });

  test("matches the Shelley start points", () => {
    expect(adaSlotAtTime("mainnet", 1_596_059_091_000)).toBe(4_492_800);
    expect(adaSlotAtTime("preprod", 1_655_769_600_000)).toBe(86_400);
  });

  test("rejects a missing or pre-Shelley timestamp", () => {
    expect(() => adaSlotAtTime("mainnet", NaN)).toThrow();
    expect(() => adaSlotAtTime("mainnet", 0)).toThrow();
    expect(() => adaSlotAtTime("preprod", 1_600_000_000_000)).toThrow();
  });
});

const rosettaStatus = (tip: typeof MAINNET_TIP) => ({
  current_block_identifier: { index: tip.block_height, hash: "00" },
  current_block_timestamp: tip.block_time * 1000,
});

describe("adaTipFromRosettaStatus", () => {
  for (const [network, tip] of [["mainnet", MAINNET_TIP], ["preprod", PREPROD_TIP]] as const) {
    test(`${network}: slot is the real tip, so ttl = slot + 7200 is ~2 h ahead`, () => {
      const res = adaTipFromRosettaStatus(network, rosettaStatus(tip));
      expect(res.blockHeight).toBe(tip.block_height);
      expect(res.slot).toBe(tip.abs_slot);
      const ahead = res.slot + 7200 - tip.abs_slot;
      expect(ahead).toBeGreaterThan(3600);
      expect(ahead).toBeLessThan(3 * 3600);
      // The old block height * 20 estimate was tens of millions of slots off
      expect(Math.abs(tip.block_height * 20 - tip.abs_slot)).toBeGreaterThan(10_000_000);
    });
  }

  // Real Tatum Rosetta /network/status responses (2026-10-15); sync_status.current_index is the node's slot
  test("real Rosetta responses give the node's own slot", () => {
    expect(adaTipFromRosettaStatus("mainnet", {
      current_block_identifier: { index: 14_071_975 }, current_block_timestamp: 1_792_078_880_000,
    }).slot).toBe(200_512_589);
    expect(adaTipFromRosettaStatus("preprod", {
      current_block_identifier: { index: 5_295_672 }, current_block_timestamp: 1_792_078_893_000,
    }).slot).toBe(136_395_693);
  });

  test("throws instead of returning a bogus slot when the timestamp is missing", () => {
    expect(() => adaTipFromRosettaStatus("mainnet", { current_block_identifier: { index: 1 } })).toThrow();
  });
});

describe("getAdaTip", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test("posts the preprod network id and returns the real preprod slot", async () => {
    let body: { network_identifier?: { network?: string } } = {};
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(rosettaStatus(PREPROD_TIP)), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await getAdaTip("https://cardano-preprod.gateway.tatum.io");
    expect(body.network_identifier?.network).toBe("preprod");
    expect(res.slot).toBe(PREPROD_TIP.abs_slot);
  });
});
