import { describe, expect, test } from "bun:test";
import { tokenAccountOf } from "./solanaAdapter";

describe("tokenAccountOf", () => {
  test("derives the associated token account the explorers show", () => {
    // USDC ATA of a known wallet (mainnet getTokenAccountsByOwner lists it, 2026-10-19).
    expect(tokenAccountOf("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"))
      .toBe("FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B");
  });
  test("falls back to the owner on a bad key", () => {
    expect(tokenAccountOf("not-base58!", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("not-base58!");
  });
});
