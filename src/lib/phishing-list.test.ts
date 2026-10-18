import { describe, expect, test } from "bun:test";
import { hostOf, hostSuffixes, isBlockedHost, parsePhishingList } from "./phishing-list";

const list = parsePhishingList({
  blacklist: ["Uniswap-claim.xyz", "evil.com", "github.io"],
  whitelist: ["good.github.io"],
  fuzzylist: ["ignored"],
})!;

describe("phishing list", () => {
  test("parse lowercases and needs a blacklist", () => {
    expect(list.blacklist.has("uniswap-claim.xyz")).toBe(true);
    expect(parsePhishingList({ whitelist: ["a.com"] })).toBeNull();
    expect(parsePhishingList(null)).toBeNull();
    expect(parsePhishingList({ blacklist: [] })).toBeNull();
  });
  test("suffixes never reach a bare TLD", () => {
    expect(hostSuffixes("a.b.example.com")).toEqual(["a.b.example.com", "b.example.com", "example.com"]);
    expect(hostSuffixes("localhost")).toEqual(["localhost"]);
  });
  test("a listed domain blocks itself and its subdomains", () => {
    expect(isBlockedHost("evil.com", list)).toBe(true);
    expect(isBlockedHost("app.EVIL.com.", list)).toBe(true);
    expect(isBlockedHost("notevil.com", list)).toBe(false);
    expect(isBlockedHost("app.uniswap.org", list)).toBe(false);
  });
  test("whitelist and kexify's directory win", () => {
    expect(isBlockedHost("x.github.io", list)).toBe(true);
    expect(isBlockedHost("good.github.io", list)).toBe(false);
    expect(isBlockedHost("app.good.github.io", list)).toBe(false);
    expect(isBlockedHost("evil.com", list, ["evil.com"])).toBe(false);
  });
  test("hosts from WalletConnect metadata", () => {
    expect(hostOf("https://App.Uniswap.org/swap?x=1")).toBe("app.uniswap.org");
    expect(hostOf("evil.com")).toBe("evil.com");
    expect(hostOf("")).toBeNull();
    expect(hostOf("http://")).toBeNull();
  });
});
