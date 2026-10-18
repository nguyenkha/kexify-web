// Address book sync, wire records and merge (plans/261018-1308-address-book-sync/plan.md).
// Mirrored by ios/KexifyCore/Sources/KexifyCore/AddressBookSyncMerge.swift.
//
// One record per chain type + address. The newer of max(added_at, deleted_at) wins; a tie goes
// to the tombstone. Tombstones older than TOMBSTONE_TTL_MS are dropped. Fields a client does
// not know are kept as they came, so an older client never erases what a newer one wrote.

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface WireRecord {
  /** address as entered */
  a: string;
  /** web chain type (evm, btc, ...), "" = any chain */
  c: string;
  /** network hint (iOS chain, e.g. "base"), optional */
  n?: string;
  /** label */
  l: string;
  /** added_at (ms) */
  t: number;
  /** deleted_at (ms): present = tombstone */
  d?: number;
  [extra: string]: unknown;
}

export interface WireBook {
  v: 1;
  entries: WireRecord[];
}

export const recordKey = (r: { a: string; c: string }) => `${r.c}:${r.a.toLowerCase()}`;
const stamp = (r: WireRecord) => Math.max(r.t || 0, r.d ?? 0);

function isRecord(x: unknown): x is WireRecord {
  const r = x as WireRecord;
  return !!r && typeof r === "object" && typeof r.a === "string" && r.a.length > 0 && typeof r.c === "string"
    && typeof r.l === "string" && Number.isFinite(r.t) && (r.d === undefined || Number.isFinite(r.d))
    && (r.n === undefined || typeof r.n === "string");
}

/** Parse the decrypted JSON; malformed records are dropped, not fatal. */
export function parseBook(json: string): WireRecord[] {
  const b = JSON.parse(json) as Partial<WireBook>;
  if (!b || !Array.isArray(b.entries)) throw new Error("malformed address book");
  return b.entries.filter(isRecord);
}

/** Canonical JSON (sorted by key) so two equal books encode the same. */
export function encodeBook(records: WireRecord[]): string {
  const sorted = [...records].sort((x, y) => (recordKey(x) < recordKey(y) ? -1 : recordKey(x) > recordKey(y) ? 1 : 0));
  return JSON.stringify({ v: 1, entries: sorted } satisfies WireBook);
}

/** Merge any number of record lists. `now` drops expired tombstones. */
export function mergeRecords(lists: WireRecord[][], now = Date.now()): WireRecord[] {
  const out = new Map<string, WireRecord>();
  for (const list of lists) {
    for (const r of list) {
      const k = recordKey(r);
      const cur = out.get(k);
      if (!cur) { out.set(k, r); continue; }
      const sr = stamp(r), sc = stamp(cur);
      if (sr > sc || (sr === sc && r.d !== undefined && cur.d === undefined)) out.set(k, r);
    }
  }
  return [...out.values()].filter((r) => r.d === undefined || now - r.d < TOMBSTONE_TTL_MS);
}

export const sameBook = (a: WireRecord[], b: WireRecord[]) => encodeBook(a) === encodeBook(b);
