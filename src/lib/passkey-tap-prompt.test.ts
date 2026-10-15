import { describe, expect, test } from "bun:test";
import { requestPasskeyTap, subscribePasskeyTap, type PasskeyTapRequest } from "./passkey-tap-prompt";

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
