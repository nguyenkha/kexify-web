import { describe, expect, test } from "bun:test";
import { dismissMigrateNotice, isMigrateNoticeDismissed, MIGRATE_NOTICE_KEY } from "./migrate-notice-dismissal";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const broken = {
  getItem: () => { throw new Error("denied"); },
  setItem: () => { throw new Error("denied"); },
};

describe("migrate notice dismissal", () => {
  test("not dismissed by default, dismissed after close", () => {
    const s = memory();
    expect(isMigrateNoticeDismissed(s)).toBe(false);
    dismissMigrateNotice(s);
    expect(isMigrateNoticeDismissed(s)).toBe(true);
    expect(s.getItem(MIGRATE_NOTICE_KEY)).toBe("1");
  });

  test("unavailable storage never throws and shows the notice", () => {
    expect(() => dismissMigrateNotice(broken)).not.toThrow();
    expect(isMigrateNoticeDismissed(broken)).toBe(false);
  });
});
