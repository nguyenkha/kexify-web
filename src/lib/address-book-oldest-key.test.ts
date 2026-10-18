import { describe, expect, test } from "bun:test";
const g = globalThis as Record<string, unknown>;
g.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { addEventListener() {} };
const { oldestKeyId } = await import("./address-book-sync");

describe("oldestKeyId", () => {
  test("oldest createdAt wins regardless of list order; ties by id; none -> null", () => {
    expect(oldestKeyId([{ id: "b", createdAt: "2026-02-01T00:00:00Z" }, { id: "a", createdAt: "2026-03-01T00:00:00Z" }, { id: "c", createdAt: "2026-01-01T00:00:00Z" }])).toBe("c");
    expect(oldestKeyId([{ id: "z", createdAt: "2026-01-01T00:00:00Z" }, { id: "y", createdAt: "2026-01-01T00:00:00Z" }])).toBe("y");
    expect(oldestKeyId([])).toBeNull();
  });
});
