// Re-picking the book workspace (the remembered wallet was deleted) moves the local book and the sync state once.
import { beforeEach, describe, expect, test } from "bun:test";

const g = globalThis as Record<string, unknown>;
const local = new Map<string, string>();
g.localStorage = { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k) };
g.sessionStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };

const { setBookWorkspace } = await import("./addressBook");

beforeEach(() => local.clear());

describe("setBookWorkspace migration", () => {
  test("moves the previous workspace's book and sync state to the new one", () => {
    local.set("kexify:abWorkspace:u1", "old");
    local.set("kexify:addressBook:old", JSON.stringify({ address_book: [{ address: "0xA", label: "a", added_at: 1 }] }));
    local.set("kexify:abSync:old", JSON.stringify({ sub: "old", abk: "x", version: 3 }));
    setBookWorkspace("u1", "new");
    expect(local.get("kexify:abWorkspace:u1")).toBe("new");
    expect(JSON.parse(local.get("kexify:addressBook:new")!).address_book[0].address).toBe("0xA");
    expect(local.has("kexify:addressBook:old")).toBe(false);
    expect(JSON.parse(local.get("kexify:abSync:new")!)).toEqual({ sub: "new", abk: "x", version: 3 });
    expect(local.has("kexify:abSync:old")).toBe(false);
  });

  test("falls back to the account id store, and never overwrites an existing target", () => {
    local.set("kexify:addressBook:u1", JSON.stringify({ address_book: [{ address: "0xB", label: "b", added_at: 1 }] }));
    setBookWorkspace("u1", "new");
    expect(JSON.parse(local.get("kexify:addressBook:new")!).address_book[0].address).toBe("0xB");

    local.set("kexify:addressBook:u1", JSON.stringify({ address_book: [{ address: "0xC", label: "c", added_at: 1 }] }));
    setBookWorkspace("u1", "new");
    expect(JSON.parse(local.get("kexify:addressBook:new")!).address_book[0].address).toBe("0xB");
  });

  test("an empty target book does not block the move, and book + sync state move together from one source", () => {
    local.set("kexify:abWorkspace:u1", "old");
    local.set("kexify:addressBook:new", JSON.stringify({ address_book: [] }));
    local.set("kexify:addressBook:old", JSON.stringify({ address_book: [{ address: "0xD", label: "d", added_at: 1 }] }));
    local.set("kexify:abSync:old", JSON.stringify({ sub: "old", abk: "y", version: 2 }));
    setBookWorkspace("u1", "new");
    expect(JSON.parse(local.get("kexify:addressBook:new")!).address_book[0].address).toBe("0xD");
    expect(JSON.parse(local.get("kexify:abSync:new")!).sub).toBe("new");
  });

  test("a target that already has a sync state takes nothing (no state without its book)", () => {
    local.set("kexify:abSync:new", JSON.stringify({ sub: "new", version: 5 }));
    local.set("kexify:addressBook:u1", JSON.stringify({ address_book: [{ address: "0xE", label: "e", added_at: 1 }] }));
    setBookWorkspace("u1", "new");
    expect(local.has("kexify:addressBook:new")).toBe(false);
    expect(local.has("kexify:addressBook:u1")).toBe(true);
  });
});
