// Address book + recent recipients, stored per workspace (kexify:addressBook:<key share id>) and synced end-to-end
// encrypted by address-book-sync.ts. The server keeps ONE book per workspace; the web shows the book of the
// login's book workspace (standalone: its own key share; email: the first key share, remembered per account).

import { getUserOverrides, setUserOverrides, type AddressBookEntry, type AddressBookTombstone, type RecentRecipientEntry, type UserOverrides } from "./userOverrides";
import { recordKey, type WireRecord } from "./address-book-sync-merge";

/** Fired after a local edit; address-book-sync.ts pushes it (kept as an event to avoid an import cycle). */
export const ADDRESS_BOOK_LOCAL_EDIT = "kexify:address-book-local-edit";
const notifyEdit = () => { globalThis.dispatchEvent?.(new Event(ADDRESS_BOOK_LOCAL_EDIT)); };
const sameKey = (a: { address: string; chain?: string }, b: { address: string; chain?: string }) =>
  a.address.toLowerCase() === b.address.toLowerCase() && (a.chain ?? "") === (b.chain ?? "");

const MAX_RECENT = 10;

export type AddressEntry = AddressBookEntry;
export type RecentRecipient = RecentRecipientEntry;

/** JWT claims `sub` / `ws` of a token. */
export function tokenClaims(token: string | null | undefined): { sub?: string; ws?: string } {
  try {
    if (!token) return {};
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { sub: p.sub || undefined, ws: p.ws || undefined };
  } catch { return {}; }
}

const wsPointerKey = (sub: string) => `kexify:abWorkspace:${sub}`;

/** The workspace whose book this account shows: the token's `ws`, else the one remembered for the account. */
export function bookWorkspaceFor(sub: string | undefined, ws: string | undefined): string | undefined {
  if (ws) return ws;
  if (!sub) return undefined;
  try { return localStorage.getItem(wsPointerKey(sub)) || undefined; } catch { return undefined; }
}

/** Remember the book workspace of account `sub`; a book kept under the account id by an earlier build moves to it. */
export function setBookWorkspace(sub: string, ws: string): void {
  const prev = localStorage.getItem(wsPointerKey(sub));
  localStorage.setItem(wsPointerKey(sub), ws);
  // Sources, in order: the previously remembered workspace (re-pick after it was deleted), then the account id (older builds).
  // The book and its sync state move together, from one source, and only into a workspace that has neither yet:
  // a state moved without its book would make the next sync see an empty book against a known version.
  const stateKey = (id: string) => `kexify:abSync:${id}`;
  const hasBook = (id: string) => (readStore(bookKey(id))?.address_book?.length ?? 0) > 0;
  if (hasBook(ws) || localStorage.getItem(stateKey(ws))) return;
  const sources = [prev, sub].filter((id): id is string => !!id && id !== ws);
  const from = sources.find((id) => hasBook(id) || localStorage.getItem(stateKey(id)));
  if (!from) return;
  const book = readStore(bookKey(from));
  if (book) { localStorage.setItem(bookKey(ws), JSON.stringify(book)); localStorage.removeItem(bookKey(from)); }
  try {
    const s = JSON.parse(localStorage.getItem(stateKey(from)) ?? "null");
    if (s && typeof s === "object") localStorage.setItem(stateKey(ws), JSON.stringify({ ...s, sub: ws }));
  } catch { /* unreadable state: the next round starts fresh */ }
  localStorage.removeItem(stateKey(from));
}

/** Current book owner: the session JWT's workspace, else the account's remembered one (also for the lock screen). */
function currentIdentityId(): string | undefined {
  let claims: { sub?: string; ws?: string } = {};
  try { claims = tokenClaims(sessionStorage.getItem("secretkey_token")); } catch { /* no sessionStorage */ }
  if (!claims.sub) {
    try { claims = { sub: JSON.parse(localStorage.getItem("kxi:identity") ?? "null")?.sub || undefined }; } catch { /* ignore */ }
  }
  return bookWorkspaceFor(claims.sub, claims.ws) ?? claims.sub;
}

const BOOK_FIELDS = ["address_book", "address_book_deleted", "recent_recipients"] as const;
type BookStore = Pick<UserOverrides, (typeof BOOK_FIELDS)[number]>;
const bookKey = (sub?: string) => (sub ? `kexify:addressBook:${sub}` : "kexify:addressBook");

function readStore(key: string): BookStore | null {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "null"); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/**
 * The book lives under its own key, not inside kexify:config: the config page exports, emails and rewrites
 * the config, and the book must stay out of that (end-to-end encrypted sync, no stale overwrites).
 * Earlier builds kept it in the unscoped kexify:config (the token lookup never found the session token):
 * the first identity to open the book on this browser takes those fields over, once.
 */
function findOverrides(sub = currentIdentityId()): { overrides: BookStore; userId?: string } {
  const store: BookStore = { ...(readStore(bookKey(sub)) ?? {}) };
  let changed = false;
  // Book fields in a config (the shared legacy one, or one imported from an old backup) move into the book,
  // so the config page never exports or emails them and sync sees them.
  for (const legacyId of sub ? [sub, undefined] : [undefined]) {
    const legacy = getUserOverrides(legacyId);
    if (!BOOK_FIELDS.some((f) => legacy[f] !== undefined)) continue;
    store.address_book = unionBy(store.address_book, legacy.address_book);
    store.address_book_deleted = unionBy(store.address_book_deleted, legacy.address_book_deleted);
    store.recent_recipients = store.recent_recipients ?? legacy.recent_recipients;
    changed = true;
    // No identity yet (signed out): show the legacy book, move nothing (no account would ever read it back).
    if (!sub) continue;
    // Also the pre-snake_case names, or userOverrides.migrate() would bring the book back for the next identity.
    for (const f of [...BOOK_FIELDS, "addressBook", "recentRecipients"]) delete (legacy as Record<string, unknown>)[f];
    setUserOverrides(legacy, legacyId);
  }
  if (sub && (changed || !readStore(bookKey(sub)))) setUserOverridesBook(store, sub);
  return { overrides: store, userId: sub };
}

/** Entries of `a`, plus those of `b` whose chain + address `a` does not have. */
function unionBy<T extends { address: string; chain?: string }>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!b?.length) return a;
  const out = [...(a ?? [])];
  for (const e of b) if (!out.some((x) => sameKey(x, e))) out.push(e);
  return out;
}

/** Run the one-time move of the legacy book now (app start), before the config page can export it. */
export function claimLegacyAddressBook(): void {
  if (currentIdentityId()) findOverrides();
}

function setUserOverridesBook(store: BookStore, sub?: string): void {
  const out: BookStore = {};
  for (const f of BOOK_FIELDS) if (store[f] !== undefined) (out as Record<string, unknown>)[f] = store[f];
  localStorage.setItem(bookKey(sub), JSON.stringify(out));
}

// ── Address Book ──────────────────────────────────────────────────

export function getAddressBook(): AddressEntry[] {
  const { overrides } = findOverrides();
  return overrides.address_book ?? [];
}

export function saveAddressEntry(entry: Omit<AddressEntry, "added_at">): void {
  const { overrides, userId } = findOverrides();
  const book: AddressEntry[] = overrides.address_book ?? [];
  const existing = book.findIndex((e) => sameKey(e, entry));
  if (existing >= 0) {
    // An edit keeps the network hint iOS gave the entry.
    book[existing] = { network: book[existing].network, ...entry, added_at: Date.now() };
  } else {
    book.push({ ...entry, added_at: Date.now() });
  }
  const deleted = (overrides.address_book_deleted ?? []).filter((d) => !sameKey(d, entry));
  setUserOverridesBook({ ...overrides, address_book: book, address_book_deleted: deleted }, userId);
  notifyEdit();
}

export function removeAddressEntry(address: string, chain?: string): void {
  const { overrides, userId } = findOverrides();
  const key = { address, chain };
  const book = (overrides.address_book ?? []).filter((e) => !sameKey(e, key));
  const deleted = (overrides.address_book_deleted ?? []).filter((d) => !sameKey(d, key));
  deleted.push({ address, chain, deleted_at: Date.now() });
  setUserOverridesBook({ ...overrides, address_book: book, address_book_deleted: deleted }, userId);
  notifyEdit();
}

// ── Sync records (address-book-sync.ts) ──────────────────────────

/** The local book (live entries + tombstones) of `sub` as wire records. */
export function readLocalRecords(sub: string): WireRecord[] {
  const { overrides } = findOverrides(sub);
  const live: WireRecord[] = (overrides.address_book ?? []).map((e) => ({
    a: e.address, c: e.chain ?? "", l: e.label ?? "", t: Number(e.added_at) || 0, ...(e.network ? { n: e.network } : {}),
  }));
  const gone: WireRecord[] = (overrides.address_book_deleted ?? []).map((d) => ({
    a: d.address, c: d.chain ?? "", l: "", t: 0, d: Number(d.deleted_at) || 0,
  }));
  return [...live, ...gone].filter((r) => r.a);
}

/** Replace the local book of `sub` with merged records (the order of existing entries is kept). */
export function writeLocalRecords(records: WireRecord[], sub: string): void {
  const { overrides, userId } = findOverrides(sub);
  const order = new Map((overrides.address_book ?? []).map((e, i) => [recordKey({ a: e.address, c: e.chain ?? "" }), i]));
  const live = records.filter((r) => r.d === undefined)
    .sort((x, y) => (order.get(recordKey(x)) ?? Infinity) - (order.get(recordKey(y)) ?? Infinity) || x.t - y.t);
  const address_book: AddressEntry[] = live.map((r) => ({
    address: r.a, label: r.l, ...(r.c ? { chain: r.c } : {}), ...(r.n ? { network: r.n } : {}), added_at: r.t,
  }));
  const address_book_deleted: AddressBookTombstone[] = records.filter((r) => r.d !== undefined)
    .map((r) => ({ address: r.a, ...(r.c ? { chain: r.c } : {}), deleted_at: r.d! }));
  setUserOverridesBook({ ...overrides, address_book, address_book_deleted }, userId);
}

// ── Recent Recipients ─────────────────────────────────────────────

export function getRecentRecipients(): RecentRecipient[] {
  const { overrides } = findOverrides();
  return overrides.recent_recipients ?? [];
}

export function addRecentRecipient(address: string, chain: string, asset: string): void {
  const { overrides, userId } = findOverrides();
  let recent: RecentRecipient[] = (overrides.recent_recipients ?? []).filter(
    (r) => !(r.address.toLowerCase() === address.toLowerCase() && r.chain === chain),
  );
  recent.unshift({ address, chain, asset, timestamp: Date.now() });
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  setUserOverridesBook({ ...overrides, recent_recipients: recent }, userId);
}

/** Get combined suggestions: address book entries first, then recent, filtered by chain */
export function getAddressSuggestions(chainType: string): (AddressEntry | RecentRecipient)[] {
  const bookEntries = getAddressBook().filter((e) => !e.chain || e.chain === chainType);
  const recentEntries = getRecentRecipients().filter((r) => r.chain === chainType);

  // Deduplicate: book entries take priority
  const seen = new Set(bookEntries.map((e) => e.address.toLowerCase()));
  const uniqueRecent = recentEntries.filter((r) => !seen.has(r.address.toLowerCase()));

  return [...bookEntries, ...uniqueRecent];
}
