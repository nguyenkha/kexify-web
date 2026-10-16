import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { verifyDirectory } from "./dapp-directory";
import { SIGNED_DIRECTORY } from "../../../api/src/dapps/directory-signed";

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

describe("dApp directory (web)", () => {
  test("the API's signed list verifies with the pinned key", () => {
    const d = verifyDirectory(SIGNED_DIRECTORY);
    expect(d.apps.length).toBeGreaterThan(5);
    expect(d.featured.length).toBeGreaterThan(0);
    expect(d.apps.every((a) => a.url.startsWith("https://"))).toBe(true);
  });

  test("a tampered payload or another key is refused", () => {
    const tampered = { ...SIGNED_DIRECTORY, payload: SIGNED_DIRECTORY.payload.replace("app.uniswap.org", "app.unlswap.org") };
    expect(() => verifyDirectory(tampered)).toThrow("signature");
    const other = ed25519.utils.randomSecretKey();
    expect(() => verifyDirectory(SIGNED_DIRECTORY, b64(ed25519.getPublicKey(other)))).toThrow("signature");
    expect(() => verifyDirectory({})).toThrow("envelope");
  });

  test("entries that are not a bare https origin are dropped", () => {
    const sk = ed25519.utils.randomSecretKey();
    const payload = JSON.stringify({ version: 1, serial: 1, updatedAt: "x", categories: ["swap"], featured: ["a", "b"], apps: [
      { id: "a", name: "A", url: "https://a.io", category: "swap", chains: ["ethereum"], description: { en: "A", vi: "A" } },
      { id: "b", name: "B", url: "https://b.io/x?ref=evil", category: "swap", chains: ["ethereum"], description: { en: "B", vi: "B" } },
      { id: "c", name: "C", url: "http://c.io", category: "swap", chains: ["ethereum"], description: { en: "C", vi: "C" } },
    ] });
    const env = { payload, signature: b64(ed25519.sign(new TextEncoder().encode(payload), sk)) };
    const d = verifyDirectory(env, b64(ed25519.getPublicKey(sk)));
    expect(d.apps.map((a) => a.id)).toEqual(["a"]);
    expect(d.featured.map((a) => a.id)).toEqual(["a"]);
  });
});
