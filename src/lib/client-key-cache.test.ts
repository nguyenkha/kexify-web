import { describe, expect, mock, test } from "bun:test";
import { CLIENT_KEY_IDLE_MS, CLIENT_KEY_UNUSED_MS, ClientKeyCache, type ClientKeyHandles } from "./client-key-cache";

function fakeEntry() {
  const freeEcdsa2pKey = mock(() => {});
  const freeEcKey2p = mock(() => {});
  const entry = { mpc: { freeEcdsa2pKey, freeEcKey2p }, ecdsa: 11, eddsa: 22 } as unknown as ClientKeyHandles;
  return { entry, freeEcdsa2pKey, freeEcKey2p };
}

function cache(at = { t: 0 }) {
  const c = new ClientKeyCache();
  c.now = () => at.t;
  return c;
}

describe("ClientKeyCache", () => {
  test("delete frees both handles once", () => {
    const c = cache();
    const { entry, freeEcdsa2pKey, freeEcKey2p } = fakeEntry();
    c.set("k", entry);
    expect(c.delete("k")).toBe(true);
    expect(c.delete("k")).toBe(false);
    expect(freeEcdsa2pKey).toHaveBeenCalledTimes(1);
    expect(freeEcdsa2pKey).toHaveBeenCalledWith(11);
    expect(freeEcKey2p).toHaveBeenCalledWith(22);
    expect(entry.ecdsa).toBeUndefined();
  });

  test("replacing an entry frees the old one", () => {
    const c = cache();
    const a = fakeEntry();
    const b = fakeEntry();
    c.set("k", a.entry);
    c.set("k", b.entry);
    expect(a.freeEcdsa2pKey).toHaveBeenCalledTimes(1);
    expect(b.freeEcdsa2pKey).not.toHaveBeenCalled();
    c.clear();
    expect(b.freeEcdsa2pKey).toHaveBeenCalledTimes(1);
  });

  test("a pinned handle is freed only when the run releases it", () => {
    const c = cache();
    const { entry, freeEcdsa2pKey } = fakeEntry();
    c.set("k", entry);
    c.pin("k");
    c.pin("k"); // nested (batch -> single)
    c.delete("k");
    expect(c.has("k")).toBe(false);
    c.unpin("k");
    expect(freeEcdsa2pKey).not.toHaveBeenCalled();
    c.unpin("k");
    expect(freeEcdsa2pKey).toHaveBeenCalledTimes(1);
  });

  test("handles retired twice under one pin are both kept until the last run ends", () => {
    const c = cache();
    const a = fakeEntry();
    const b = fakeEntry();
    c.set("k", a.entry);
    c.pin("k"); // a sign uses A
    c.delete("k"); // dialog closed
    c.set("k", b.entry); // reopened, restored as B
    c.delete("k"); // closed again
    expect(a.freeEcdsa2pKey).not.toHaveBeenCalled();
    expect(b.freeEcdsa2pKey).not.toHaveBeenCalled();
    c.unpin("k");
    expect(a.freeEcdsa2pKey).toHaveBeenCalledTimes(1);
    expect(b.freeEcdsa2pKey).toHaveBeenCalledTimes(1);
  });

  test("a handle no sign used yet (tx still building, keygen) gets CLIENT_KEY_UNUSED_MS", () => {
    const at = { t: 0 };
    const c = cache(at);
    const { entry, freeEcdsa2pKey } = fakeEntry();
    c.set("k", entry);
    at.t = CLIENT_KEY_IDLE_MS * 2;
    c.sweep();
    expect(c.has("k")).toBe(true);
    at.t = CLIENT_KEY_UNUSED_MS;
    c.sweep();
    expect(c.has("k")).toBe(false);
    expect(freeEcdsa2pKey).toHaveBeenCalledTimes(1);
  });

  test("idle sweep frees after CLIENT_KEY_IDLE_MS, never while pinned, and use resets the clock", () => {
    const at = { t: 0 };
    const c = cache(at);
    const idle = fakeEntry();
    const busy = fakeEntry();
    c.set("idle", idle.entry);
    c.set("busy", busy.entry);
    c.pin("idle"); c.unpin("idle"); // used by a sign
    c.pin("busy");
    at.t = CLIENT_KEY_IDLE_MS - 1;
    c.sweep();
    expect(c.size).toBe(2);
    at.t = CLIENT_KEY_IDLE_MS;
    c.sweep();
    expect(c.has("idle")).toBe(false);
    expect(idle.freeEcdsa2pKey).toHaveBeenCalledTimes(1);
    expect(c.has("busy")).toBe(true);
    c.unpin("busy"); // last use now
    at.t = 2 * CLIENT_KEY_IDLE_MS - 1;
    c.sweep();
    expect(c.has("busy")).toBe(true);
    at.t = 2 * CLIENT_KEY_IDLE_MS;
    c.sweep();
    expect(c.size).toBe(0);
    expect(busy.freeEcdsa2pKey).toHaveBeenCalledTimes(1);
  });

  test("sweep all (page hide) skips pinned keys", () => {
    const c = cache();
    const a = fakeEntry();
    const b = fakeEntry();
    c.set("a", a.entry);
    c.set("b", b.entry);
    c.pin("b");
    c.sweep({ all: true });
    expect([...c.keys()]).toEqual(["b"]);
    c.unpin("b");
    c.clear();
  });
});
