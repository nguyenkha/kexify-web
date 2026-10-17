import { afterEach, describe, expect, test } from "bun:test";
import { lackedUserActivation, requestPasskeyTap, subscribePasskeyTap, type PasskeyTapRequest } from "./passkey-tap-prompt";

describe("requestPasskeyTap", () => {
  test("a newer request rejects the one it replaces; the newer one still settles", async () => {
    const seen: PasskeyTapRequest[] = [];
    const unsubscribe = subscribePasskeyTap((r) => seen.push(r));
    const first = requestPasskeyTap(false, { action: "unfreeze" });
    const second = requestPasskeyTap(true, { action: "sign", keyShareId: "k", digests: ["a".repeat(64)] });
    await expect(first).rejects.toThrow("passkey_auth_required");
    seen[1].resolve({ token: "t2" });
    expect(await second).toEqual({ token: "t2" });
    seen[0].resolve({ token: "late" }); // a superseded ceremony finishing late changes nothing
    unsubscribe();
  });

  test("without a host the request fails instead of hanging", async () => {
    await expect(requestPasskeyTap(false, { action: "unfreeze" })).rejects.toThrow("passkey_auth_required");
  });
});

describe("lackedUserActivation", () => {
  const notAllowed = Object.assign(new Error("The operation is not allowed"), { name: "NotAllowedError" });
  const setActivation = (value: { isActive: boolean } | undefined) =>
    Object.defineProperty(navigator, "userActivation", { value, configurable: true });
  afterEach(() => { delete (navigator as { userActivation?: unknown }).userActivation; });

  test("without navigator.userActivation (Safari < 16.4) a NotAllowedError gets the Confirm button", () => {
    setActivation(undefined);
    expect(lackedUserActivation(notAllowed)).toBe(true);
    expect(lackedUserActivation({ name: "Error", cause: { name: "NotAllowedError" } })).toBe(true);
  });

  test("with navigator.userActivation only a spent activation gets the Confirm button", () => {
    setActivation({ isActive: false });
    expect(lackedUserActivation(notAllowed)).toBe(true);
    setActivation({ isActive: true });
    expect(lackedUserActivation(notAllowed)).toBe(false); // an active page that got NotAllowedError: a real cancel
  });

  test("other errors never get the Confirm button", () => {
    setActivation(undefined);
    expect(lackedUserActivation(new Error("network"))).toBe(false);
    expect(lackedUserActivation(Object.assign(new Error("x"), { name: "InvalidStateError" }))).toBe(false);
    expect(lackedUserActivation(null)).toBe(false);
  });
});
