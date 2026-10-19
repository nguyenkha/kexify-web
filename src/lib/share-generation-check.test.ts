import { describe, expect, test } from "bun:test";
import { assertSameShareGeneration, shareGenerationOf } from "./share-generation-check";

describe("share generation check", () => {
  test("files without a generation are generation 0", () => {
    expect(shareGenerationOf({})).toBe(0);
    expect(shareGenerationOf({ shareGeneration: null })).toBe(0);
    expect(shareGenerationOf({ shareGeneration: 3 })).toBe(3);
    expect(shareGenerationOf({ shareGeneration: -1 })).toBe(0);
    expect(() => assertSameShareGeneration({}, { shareGeneration: 0 })).not.toThrow();
  });

  test("a mismatch is refused with both generations named", () => {
    expect(() => assertSameShareGeneration({ shareGeneration: 3 }, { shareGeneration: 2 }))
      .toThrow("different key versions: client gen 3, server gen 2");
    expect(() => assertSameShareGeneration({}, { shareGeneration: 1 })).toThrow("client gen 0, server gen 1");
  });
});
