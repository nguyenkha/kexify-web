import { describe, expect, test } from "bun:test";
import {
  __test, deriveKek, deriveKekFromAscii, encodeEnvelope, newAbk, openBody, pad, parseEnvelope, sealBody, unpad, unwrapAbk, wrapAbk,
} from "./address-book-sync-crypto";
import { encodeBook, mergeRecords, parseBook, TOMBSTONE_TTL_MS, type WireRecord } from "./address-book-sync-merge";
import { syncOnce, type PutResult, type RemoteBook, type SyncIO, type SyncState } from "./address-book-sync-engine";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

// Shared with ios/KexifyCore/Tests/KexifyCoreTests/AddressBookSyncTests.swift: change both together.
const VEC = {
  share: "AAECAwQFBgcICQ==,EBESExQVFhcYGQ==",
  keyShareId: "ks-1",
  sub: "user-1",
  abk: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
  iv: Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i),
  json: '{"v":1,"entries":[{"a":"0xAbC","c":"evm","n":"base","l":"Bob","t":1700000000000}]}',
};

describe("address book crypto", () => {
  test("KEK, wrap and body match the fixed vectors (web <-> iOS)", async () => {
    const kek = deriveKek(VEC.share, VEC.keyShareId);
    expect(hex(kek)).toBe("0344fad8595231a14fda38760f26db675f3f2234df4ba0946431995cd6d4756f");
    const wrap = await __test.seal(kek, VEC.abk, __test.wrapAad(VEC.sub, VEC.keyShareId), VEC.iv);
    expect(b64(wrap)).toBe("oKGio6Slpqeoqaqryw73IRJQ5fTBfjI6ijO035dgXgOtksBAz3njU9unImiM9CV3Ry8LPPzZvrwWrK2d");
    const body = await __test.seal(VEC.abk, pad(VEC.json), __test.bodyAad(VEC.sub), VEC.iv);
    expect(body.length).toBe(12 + 1024 + 16);
    expect(hex(body.slice(0, 40))).toBe("a0a1a2a3a4a5a6a7a8a9aaabb9d13d3486972c26453f8e4994eb54f63eb2c33b62331ba64679efdf");
    expect(unpad(await __test.open(VEC.abk, body, __test.bodyAad(VEC.sub)))).toBe(VEC.json);
  });

  test("the PRF byte path derives the same KEK as the share string", () => {
    expect(hex(deriveKekFromAscii(new TextEncoder().encode(VEC.share), VEC.keyShareId))).toBe(hex(deriveKek(VEC.share, VEC.keyShareId)));
  });

  test("KEK depends on the share and the key share id", () => {
    const a = hex(deriveKek(VEC.share, "ks-1"));
    expect(hex(deriveKek(VEC.share, "ks-2"))).not.toBe(a);
    expect(hex(deriveKek(VEC.share + "x", "ks-1"))).not.toBe(a);
  });

  test("wrap opens only with the right KEK, account and wallet", async () => {
    const kek = deriveKek(VEC.share, "ks-1");
    const abk = newAbk();
    const w = await wrapAbk(kek, abk, "user-1", "ks-1");
    expect(hex(await unwrapAbk(kek, w, "user-1", "ks-1"))).toBe(hex(abk));
    await expect(unwrapAbk(kek, w, "user-2", "ks-1")).rejects.toThrow();
    await expect(unwrapAbk(kek, w, "user-1", "ks-2")).rejects.toThrow();
    await expect(unwrapAbk(deriveKek("other", "ks-1"), w, "user-1", "ks-1")).rejects.toThrow();
  });

  test("body is bound to the account and pads to 1 KiB steps", async () => {
    const abk = newAbk();
    const ct = await sealBody(abk, "{}", "user-1");
    expect(await openBody(abk, ct, "user-1")).toBe("{}");
    await expect(openBody(abk, ct, "user-2")).rejects.toThrow();
    expect(pad("x".repeat(1019)).length).toBe(1024 * 2 - 1024); // 4 + 1019 = 1023 -> 1024
    expect(pad("x".repeat(1021)).length).toBe(2048);
    const tampered = atob(ct).split("");
    tampered[20] = String.fromCharCode(tampered[20].charCodeAt(0) ^ 1);
    await expect(openBody(abk, btoa(tampered.join("")), "user-1")).rejects.toThrow();
  });

  test("envelope parse rejects other versions and junk", () => {
    expect(parseEnvelope(encodeEnvelope({ a: "x" }, "y"))).toEqual({ v: 1, wraps: { a: "x" }, ct: "y" });
    expect(() => parseEnvelope('{"v":2,"wraps":{},"ct":""}')).toThrow();
    expect(() => parseEnvelope('{"v":1,"wraps":[],"ct":""}')).toThrow();
    expect(() => parseEnvelope("null")).toThrow();
  });
});

const rec = (a: string, t: number, extra: Partial<WireRecord> = {}): WireRecord => ({ a, c: "evm", l: a, t, ...extra });

describe("address book merge", () => {
  test("newer wins per chain + address, case-insensitive; tie goes to the tombstone", () => {
    const m = mergeRecords([[rec("0xA", 10, { l: "old" })], [rec("0xa", 20, { l: "new" })]], 100);
    expect(m).toHaveLength(1);
    expect(m[0].l).toBe("new");
    const del = mergeRecords([[rec("0xA", 10)], [rec("0xa", 0, { d: 10 })]], 100);
    expect(del[0].d).toBe(10);
    const readd = mergeRecords([[rec("0xA", 0, { d: 10 })], [rec("0xA", 11)]], 100);
    expect(readd[0].d).toBeUndefined();
    expect(mergeRecords([[rec("0xA", 1, { c: "btc" })], [rec("0xA", 1)]], 100)).toHaveLength(2);
  });

  test("old tombstones are dropped", () => {
    const now = 1_000 + TOMBSTONE_TTL_MS;
    expect(mergeRecords([[rec("0xA", 0, { d: 999 })]], now)).toHaveLength(0);
    expect(mergeRecords([[rec("0xA", 0, { d: 1001 })]], now)).toHaveLength(1);
  });

  test("parse drops malformed records and keeps unknown chains", () => {
    const json = JSON.stringify({ v: 1, entries: [rec("0xA", 1), { a: 1 }, rec("addr", 2, { c: "future-chain" })] });
    expect(parseBook(json).map((r) => r.c)).toEqual(["evm", "future-chain"]);
    expect(encodeBook([rec("b", 1), rec("a", 1)])).toBe(encodeBook([rec("a", 1), rec("b", 1)]));
  });
});

/** In-memory server with the route's If-Match semantics, plus one device's local storage. */
function server() {
  const s = { version: 0, blob: null as string | null, puts: 0 };
  return {
    s,
    get: async (): Promise<RemoteBook> => ({ version: s.version, blob: s.blob }),
    put: async (blob: string, expected: number): Promise<PutResult> => {
      s.puts++;
      if (expected !== s.version) return { ok: false, conflict: { version: s.version, blob: s.blob } };
      s.version++; s.blob = blob;
      return { ok: true, version: s.version };
    },
  };
}

function device(srv: ReturnType<typeof server>, sub: string, keks: Record<string, Uint8Array>) {
  let local: WireRecord[] = [];
  let state: SyncState | null = null;
  const io: SyncIO = {
    sub, get: srv.get, put: srv.put,
    readLocal: () => local, updateLocal: (next) => (local = next(local)),
    loadState: () => state, saveState: (st) => { state = st; },
    ownKeks: async () => new Map(Object.entries(keks)),
    now: () => 5_000,
  };
  return {
    io, sync: () => syncOnce(io),
    get local() { return local; }, set local(r) { local = r; },
    get state() { return state; },
    lose: (id: string) => { delete keks[id]; },
  };
}

describe("address book sync round", () => {
  const kA = deriveKek("share-A", "ks-A");
  const kB = deriveKek("share-B", "ks-B");

  test("first device migrates its local book; a second device with the same wallet gets it", async () => {
    const srv = server();
    const web = device(srv, "u", { "ks-A": kA });
    web.local = [rec("0xWeb", 1)];
    expect(await web.sync()).toBe("synced");
    expect(srv.s.version).toBe(1);
    expect(srv.s.blob).not.toContain("0xWeb");

    const ios = device(srv, "u", { "ks-A": kA });
    ios.local = [rec("0xIos", 2)];
    expect(await ios.sync()).toBe("synced");
    expect(ios.local.map((r) => r.a).sort()).toEqual(["0xIos", "0xWeb"]);
    expect(await web.sync()).toBe("synced");
    expect(web.local.map((r) => r.a).sort()).toEqual(["0xIos", "0xWeb"]);
    expect(srv.s.version).toBe(2); // the last round had nothing to push
  });

  test("a cached key syncs with no wallet unlocked; deletions travel as tombstones", async () => {
    const srv = server();
    const web = device(srv, "u", { "ks-A": kA });
    web.local = [rec("0x1", 1), rec("0x2", 1)];
    await web.sync();
    const ios = device(srv, "u", { "ks-A": kA });
    await ios.sync();
    ios.lose("ks-A");
    ios.local = ios.local.map((r) => (r.a === "0x1" ? { ...r, d: 50 } : r));
    expect(await ios.sync()).toBe("synced");
    await web.sync();
    expect(web.local.find((r) => r.a === "0x1")?.d).toBe(50);
  });

  test("concurrent edits: the loser of the 409 merges and retries", async () => {
    const srv = server();
    const a = device(srv, "u", { "ks-A": kA });
    await a.sync();
    const b = device(srv, "u", { "ks-A": kA });
    await b.sync();
    b.local = [rec("0xB", 3)];
    await b.sync(); // server now v2
    a.local = [rec("0xA", 4)];
    const before = srv.s.puts;
    expect(await a.sync()).toBe("synced");
    expect(srv.s.puts - before).toBe(1); // a pulled first, so no conflict at all
    // Force a stale write: b pushes with the version it saw before a's push.
    b.local = [...b.local, rec("0xB2", 5)];
    const stale = b.io.get;
    let first = true;
    b.io.get = async () => (first ? ((first = false), { version: 2, blob: (await stale()).blob }) : stale());
    expect(await b.sync()).toBe("synced");
    expect(b.local.map((r) => r.a).sort()).toEqual(["0xA", "0xB", "0xB2"]);
  });

  test("a device with no shared wallet is locked and keeps its local book; a second wallet adds a wrap", async () => {
    const srv = server();
    const web = device(srv, "u", { "ks-A": kA });
    await web.sync();
    const ios = device(srv, "u", { "ks-B": kB });
    ios.local = [rec("0xIos", 1)];
    expect(await ios.sync()).toBe("locked");
    expect(ios.local).toHaveLength(1);
    // The web unlocks wallet B too: it wraps the key for B.
    const web2 = device(srv, "u", { "ks-A": kA, "ks-B": kB });
    await web2.sync();
    expect(Object.keys(parseEnvelope(srv.s.blob!).wraps).sort()).toEqual(["ks-A", "ks-B"]);
    expect(await ios.sync()).toBe("synced");
    expect(srv.s.blob).toBeTruthy();
  });

  test("a new book is never created without a usable wrap", async () => {
    const srv = server();
    const d = device(srv, "u", { "ks-A": new Uint8Array(32) });
    expect(await d.sync()).toBe("needs-unlock");
    expect(srv.s.puts).toBe(0);
  });

  test("nothing on the server and no unlocked wallet: wait, push nothing", async () => {
    const srv = server();
    const d = device(srv, "u", {});
    d.local = [rec("0x1", 1)];
    expect(await d.sync()).toBe("needs-unlock");
    expect(srv.s.puts).toBe(0);
  });

  test("a stale wrap (reshare) is replaced by a device that still holds the key", async () => {
    const srv = server();
    const d = device(srv, "u", { "ks-A": kA });
    await d.sync();
    const fresh = deriveKek("share-A-after-reshare", "ks-A");
    const d2 = device(srv, "u", { "ks-A": fresh });
    expect(await d2.sync()).toBe("locked");
    const d3 = device(srv, "u", { "ks-A": fresh });
    // d3 holds the cached key from d
    d3.io.loadState = () => d.state;
    expect(await d3.sync()).toBe("synced");
    expect(await d2.sync()).toBe("synced");
  });

  test("a state saved for another account is ignored", async () => {
    const srv = server();
    const d = device(srv, "u2", { "ks-A": kA });
    d.local = [rec("0xMine", 1)];
    d.io.loadState = () => ({ sub: "u1", abk: newAbk(), version: 3 });
    expect(await d.sync()).toBe("synced");
    expect(srv.s.version).toBe(1);
  });

  test("an edit made while the round waits on the network is kept and pushed", async () => {
    const srv = server();
    const d = device(srv, "u", { "ks-A": kA });
    d.local = [rec("0x1", 1)];
    const get = d.io.get;
    d.io.get = async () => { const r = await get(); d.local = [...d.local, rec("0xDuring", 2)]; return r; };
    expect(await d.sync()).toBe("synced");
    expect(d.local.map((r) => r.a).sort()).toEqual(["0x1", "0xDuring"]);
    const other = device(srv, "u", { "ks-A": kA });
    await other.sync();
    expect(other.local.map((r) => r.a).sort()).toEqual(["0x1", "0xDuring"]);
  });
});

describe("local book storage", () => {
  test("the legacy shared book moves once, aliases included, and stays out of the config", async () => {
    const store = new Map<string, string>();
    const g = globalThis as Record<string, unknown>;
    const saved = g.localStorage;
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    };
    store.set("kexify:config", JSON.stringify({ addressBook: [{ address: "0xA", label: "a", chain: "evm", addedAt: 1 }], hide_balances: true }));
    const { readLocalRecords } = await import("./addressBook");
    expect(readLocalRecords("u1").map((r) => r.a)).toEqual(["0xA"]);
    expect(readLocalRecords("u2")).toEqual([]);
    const cfg = JSON.parse(store.get("kexify:config")!);
    expect(cfg.address_book).toBeUndefined();
    expect(cfg.addressBook).toBeUndefined();
    expect(cfg.hide_balances).toBe(true);
    expect(JSON.parse(store.get("kexify:addressBook:u1")!).address_book).toHaveLength(1);
    // An old config backup imported later: its book joins the book and leaves the config.
    store.set("kexify:config:u1", JSON.stringify({ address_book: [{ address: "0xB", label: "b", chain: "evm", added_at: 2 }] }));
    expect(readLocalRecords("u1").map((r) => r.a).sort()).toEqual(["0xA", "0xB"]);
    expect(JSON.parse(store.get("kexify:config:u1")!).address_book).toBeUndefined();
    g.localStorage = saved;
  });
});
