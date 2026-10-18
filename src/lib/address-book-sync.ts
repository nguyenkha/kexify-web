// Web wiring for the end-to-end encrypted address book sync (plans/261018-1308-address-book-sync/plan.md).
//
// The local book (userOverrides.address_book, tombstones in address_book_deleted) stays the cache
// the UI reads. A round runs on start, when the tab comes back, after a wallet unlock (new KEK),
// and shortly after a local change. The account key (ABK) is cached in localStorage next to the
// plaintext cache, so later rounds need no unlock.

import { apiUrl } from "./apiBase";
import { getToken } from "./auth";
import { isRecoveryMode } from "./recovery";
import { availableKeks, onKekAdded } from "./address-book-kek";
import { syncOnce, type RemoteBook, type SyncIO, type SyncState, type SyncStatus } from "./address-book-sync-engine";
import { ADDRESS_BOOK_LOCAL_EDIT, claimLegacyAddressBook, readLocalRecords, tokenSub, writeLocalRecords } from "./addressBook";

const STATE_KEY = "kexify:abSync";
export const ADDRESS_BOOK_CHANGED = "kexify:address-book-changed";
const DEBOUNCE_MS = 1500;

let status: SyncStatus | "idle" | "error" = "idle";
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let ownedIds: { sub: string; ids: Set<string> } | null = null;

const b64 = (b: Uint8Array) => { let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function loadState(sub: string): SyncState | null {
  try {
    const s = JSON.parse(localStorage.getItem(`${STATE_KEY}:${sub}`) ?? "null");
    if (!s || typeof s.sub !== "string" || typeof s.abk !== "string" || !Number.isInteger(s.version)) return null;
    const abk = unb64(s.abk);
    return abk.length === 32 ? { sub: s.sub, abk, version: s.version } : null;
  } catch { return null; }
}

function saveState(s: SyncState): void {
  localStorage.setItem(`${STATE_KEY}:${s.sub}`, JSON.stringify({ sub: s.sub, abk: b64(s.abk), version: s.version }));
}

/** Every request of a round carries the token the round started with, so a sign-in switch cannot redirect it. */
async function api(token: string, method: "GET" | "PUT", body?: unknown, version?: number): Promise<Response> {
  return fetch(apiUrl("/api/address-book"), {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(version !== undefined ? { "If-Match": `"${version}"` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function remoteFrom(j: { version?: unknown; blob?: unknown }): RemoteBook {
  return { version: Number(j.version) || 0, blob: typeof j.blob === "string" ? j.blob : null };
}

/** Key share ids of this account (a standalone token owns only itself). Cached per account. */
async function ownKeks(sub: string, token: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const all = availableKeks();
  const out = new Map<string, Uint8Array>();
  if (all.size === 0) return out;
  if ([...all.keys()].some((id) => id !== sub && !(ownedIds?.sub === sub && ownedIds.ids.has(id)))) {
    const res = await fetch(apiUrl("/api/keys"), { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const rows = ((await res.json()) as { keys?: { id?: unknown }[] }).keys ?? [];
      ownedIds = { sub, ids: new Set(rows.map((r) => String(r.id))) };
    }
  }
  // Copies: a sign-out mid-round must not change the keys under the round; wiped when the round ends.
  for (const [id, kek] of all) if (id === sub || (ownedIds?.sub === sub && ownedIds.ids.has(id))) out.set(id, kek.slice());
  return out;
}

async function round(): Promise<void> {
  const token = getToken();
  const sub = tokenSub(token);
  if (!token || !sub || isRecoveryMode()) return;
  const io: SyncIO = {
    sub,
    async get() {
      const res = await api(token, "GET");
      if (!res.ok) throw new Error(`address book GET ${res.status}`);
      return remoteFrom(await res.json());
    },
    async put(blob, expected) {
      // Signed out or switched account since the round started: send nothing.
      if (getToken() !== token) throw new Error("session changed");
      const res = await api(token, "PUT", { blob }, expected);
      const j = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, version: Number(j.version) };
      if (res.status === 409) return { ok: false, conflict: remoteFrom(j) };
      throw new Error(`address book PUT ${res.status}`);
    },
    readLocal: () => readLocalRecords(sub),
    updateLocal(next) {
      const stored = next(readLocalRecords(sub)); // synchronous: no edit can land in between
      writeLocalRecords(stored, sub);
      window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED));
      return stored;
    },
    loadState: () => loadState(sub),
    saveState,
    ownKeks: async () => (keks = await ownKeks(sub, token)),
  };
  let keks: ReadonlyMap<string, Uint8Array> = new Map();
  try {
    status = await syncOnce(io);
  } catch (err) {
    status = "error";
    console.warn("[address-book] sync failed:", err instanceof Error ? err.message : err);
  }
  for (const k of keks.values()) k.fill(0);
  window.dispatchEvent(new Event(ADDRESS_BOOK_CHANGED));
}

/** Run a round now (coalesced: one at a time, one queued). */
export function syncAddressBookNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = round().finally(() => {
    running = null;
    if (again) { again = false; void syncAddressBookNow(); }
  });
  return running;
}

/** After a local edit: debounce, then push. */
export function scheduleAddressBookSync(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncAddressBookNow(); }, DEBOUNCE_MS);
}

export function addressBookSyncStatus(): typeof status {
  return status;
}

/** App start: first round, then on tab return and on each new wallet unlock. */
export function installAddressBookSync(): void {
  try { claimLegacyAddressBook(); } catch { /* storage unavailable */ }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void syncAddressBookNow(); });
  window.addEventListener("kexify:token", () => void syncAddressBookNow());
  window.addEventListener(ADDRESS_BOOK_LOCAL_EDIT, () => scheduleAddressBookSync());
  onKekAdded(() => scheduleAddressBookSync());
  void syncAddressBookNow();
}
