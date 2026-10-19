// The device signer record on the IndexedDB path (other tests use the memory path): the signer id and status
// must really be stored. Regression: tx() replaced the onsuccess of compareAndPut's get, so its put never ran.
import { afterAll, describe, expect, test } from "bun:test";

/** Minimal IndexedDB: one store, requests fire onsuccess + "success" listeners, the transaction completes when idle. */
function fakeIndexedDb() {
  const data = new Map<string, unknown>();
  const later = (fn: () => void) => setTimeout(fn, 0);
  function transaction() {
    let pending = 0;
    const t: Record<string, unknown> & { oncomplete?: () => void } = {};
    const settle = () => later(() => { if (pending === 0) t.oncomplete?.(); });
    const request = (op: () => unknown) => {
      pending++;
      const listeners: Array<() => void> = [];
      const req: Record<string, unknown> & { onsuccess?: () => void } = {
        result: undefined,
        addEventListener: (type: string, fn: () => void) => { if (type === "success") listeners.push(fn); },
      };
      later(() => {
        req.result = op();
        req.onsuccess?.();
        listeners.forEach((fn) => fn());
        pending--;
        settle();
      });
      return req;
    };
    const clone = (v: unknown) => ({ ...(v as object) });
    t.objectStore = () => ({
      get: (k: string) => request(() => (data.has(k) ? clone(data.get(k)) : undefined)),
      put: (v: { keyShareId: string }) => request(() => { data.set(v.keyShareId, clone(v)); return v.keyShareId; }),
      add: (v: { keyShareId: string }) => request(() => { if (data.has(v.keyShareId)) throw new Error("ConstraintError"); data.set(v.keyShareId, clone(v)); return v.keyShareId; }),
    });
    return t;
  }
  const db = { transaction, close() {}, createObjectStore() {} };
  return {
    data,
    open: () => {
      const req: Record<string, unknown> & { onsuccess?: () => void; onupgradeneeded?: () => void } = { result: db };
      later(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
}

const g = globalThis as Record<string, unknown>;
const prevIdb = g.indexedDB;
const fake = fakeIndexedDb();
g.indexedDB = fake;
g.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
afterAll(() => { g.indexedDB = prevIdb; });

const key = await import("./device-signer-key");

describe("device signer record in IndexedDB", () => {
  test("a new record is stored, then setLocalSignerState persists signerId and status", async () => {
    const KS = "aaaaaaaa-1111-4222-8333-444455556666";
    const rec = await key.getOrCreateSignerRecord(KS);
    expect(fake.data.has(KS)).toBe(true);
    expect(key.volatileKeys.has(KS)).toBe(false); // really in IndexedDB, not the memory fallback

    await key.setLocalSignerState(KS, { signerId: "signer-1", status: "pending" }, rec.spki);
    expect(fake.data.get(KS)).toMatchObject({ signerId: "signer-1", status: "pending", spki: rec.spki });
    expect(await key.getSignerRecord(KS)).toMatchObject({ signerId: "signer-1", status: "pending" });

    await key.setLocalSignerState(KS, { status: "active" }, rec.spki);
    expect((await key.getSignerRecord(KS))?.status).toBe("active");

    // Another key's state is never written over this one.
    await key.setLocalSignerState(KS, { status: "revoked" }, "other-spki");
    expect((await key.getSignerRecord(KS))?.status).toBe("active");
  });
});
