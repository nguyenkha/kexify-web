import { describe, expect, test } from "bun:test";
import { base64DecodeAscii, findJsonStringField, sharePartsFromAscii, sharePartsFromString, wipe } from "./secret-bytes";

const ascii = (s: string) => new TextEncoder().encode(s);
const atobBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

describe("base64DecodeAscii", () => {
  test("matches atob for every length 0..64", () => {
    for (let n = 0; n <= 64; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      expect(base64DecodeAscii(ascii(b64(bytes)))).toEqual(bytes);
    }
  });

  test("is as lenient as atob: no padding, whitespace", () => {
    expect(base64DecodeAscii(ascii("aGk"))).toEqual(atobBytes("aGk="));
    expect(base64DecodeAscii(ascii(" aG\nk= "))).toEqual(atobBytes("aGk="));
  });

  test("rejects what atob rejects", () => {
    expect(() => base64DecodeAscii(ascii("a"))).toThrow();
    expect(() => base64DecodeAscii(ascii("ab=c"))).toThrow();
    expect(() => base64DecodeAscii(ascii("ab$c"))).toThrow();
    for (const bad of ["aGk==", "aGk====", "aG===", "aGVs="]) {
      expect(() => atob(bad)).toThrow();
      expect(() => base64DecodeAscii(ascii(bad))).toThrow();
    }
  });
});

describe("share parts", () => {
  const parts = [new Uint8Array([1, 2, 3]), crypto.getRandomValues(new Uint8Array(70)), new Uint8Array([255])];
  const share = parts.map(b64).join(",");

  test("decode from string and from bytes give the same parts", () => {
    expect(sharePartsFromString(share)).toEqual(parts);
    expect(sharePartsFromAscii(ascii(share))).toEqual(parts);
    expect(sharePartsFromString("")).toEqual([]);
  });

  test("a non-ASCII character is not folded into a valid one", () => {
    // U+0141 & 0xff = 0x41 ("A"): must fail like atob, not decode as "A".
    expect(() => sharePartsFromString("ŁAAA")).toThrow();
  });

  test("wipe zeroes single buffers and part lists", () => {
    const a = new Uint8Array([9, 9]);
    const list = [new Uint8Array([7]), new Uint8Array([8, 8])];
    wipe(a, list, null, undefined);
    expect([...a, ...list[0], ...list[1]].every((b) => b === 0)).toBe(true);
  });
});

describe("findJsonStringField", () => {
  const json = ascii(JSON.stringify({ id: "k1", peer: 1, share: "QUJD,REVG", publicKey: "02ab", eddsaShare: "R0hJ", eddsaPublicKey: "" }));

  test("finds share and eddsaShare without confusing the two", () => {
    const s = findJsonStringField(json, "share")!;
    const e = findJsonStringField(json, "eddsaShare")!;
    expect(new TextDecoder().decode(json.subarray(...s))).toBe("QUJD,REVG");
    expect(new TextDecoder().decode(json.subarray(...e))).toBe("R0hJ");
  });

  test("ignores a matching text inside another value and handles absence", () => {
    const tricky = ascii(JSON.stringify({ id: 'x,"share":"AAAA', share: "QUJD" }));
    const at = findJsonStringField(tricky, "share")!;
    expect(new TextDecoder().decode(tricky.subarray(...at))).toBe("QUJD");
    expect(findJsonStringField(ascii("{}"), "share")).toBeNull();
  });

  test("rejects an escaped value", () => {
    expect(() => findJsonStringField(ascii('{"share":"a\\"b"}'), "share")).toThrow();
  });
});
