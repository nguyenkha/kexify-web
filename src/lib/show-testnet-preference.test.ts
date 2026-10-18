// "Show test networks" is a plain setting (#291): it holds without Expert mode; Expert-only prefs still need it.
import { beforeEach, expect, test } from "bun:test";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const { getPreference, setUserOverrides } = await import("./userOverrides");

beforeEach(() => localStorage.removeItem("kexify:config:u1"));

test("show_testnet holds without Expert mode", () => {
  setUserOverrides({ preferences: { show_testnet: true } }, "u1");
  expect(getPreference("show_testnet", "u1")).toBe(true);
});

test("off by default", () => {
  expect(getPreference("show_testnet", "u1")).toBeFalsy();
});

test("Expert-only prefs still fall back to their default without Expert mode", () => {
  setUserOverrides({ preferences: { confirm_before_broadcast: true } }, "u1");
  expect(getPreference("confirm_before_broadcast", "u1")).toBe(false);
  setUserOverrides({ preferences: { confirm_before_broadcast: true, expert_mode: true } }, "u1");
  expect(getPreference("confirm_before_broadcast", "u1")).toBe(true);
});
