import { describe, expect, test } from "bun:test";
import { mapSendError, LocalizedSendError } from "./send-error";

// Identity translator: returns the key, so assertions read as keys.
const t = (key: string) => key;

describe("mapSendError", () => {
  test("passkey cancel is silent", () => {
    const err = Object.assign(new Error("The operation either timed out or was not allowed."), { name: "NotAllowedError" });
    expect(mapSendError(err, t).kind).toBe("cancelled");
  });

  test("policy block by localised leg text and by default server text", () => {
    expect(mapSendError(new Error("send.policyBlockedLeg.fee"), t)).toEqual({ kind: "policy", message: "send.policyBlockedLeg.fee", policyLeg: "fee" });
    const def = mapSendError(new Error("Blocked by policy rules. You can adjust your policy in account settings."), t);
    expect(def).toEqual({ kind: "policy", message: "send.policyBlockedDefault", policyLeg: null });
  });

  test("structured blockedLeg wins; transfer leg uses the default reason", () => {
    const err = Object.assign(new Error("x"), { blockedLeg: "transfer" });
    expect(mapSendError(err, t)).toEqual({ kind: "policy", message: "send.policyBlockedDefault", policyLeg: "transfer" });
  });

  test("known server failures map to keys", () => {
    expect(mapSendError(new Error("send.chainBinding.mismatch"), t).message).toBe("send.chainBinding.mismatch");
    expect(mapSendError(new Error("passkey_auth_required"), t).message).toBe("send.passkeySessionExpired");
    expect(mapSendError(new Error("This account is disabled. Enable it in account settings to sign transactions."), t).message).toBe("activity.blockedDisabledDetail");
    expect(mapSendError(new Error("Too many requests"), t).message).toBe("common.rateLimited");
    expect(mapSendError(new Error("Another operation is in progress"), t).message).toBe("send.busy");
    expect(mapSendError(new Error("Account is frozen"), t).message).toBe("freeze.blockedReason");
    expect(mapSendError(new Error("Error: MPC server error 404: {\"error\":\"Session not found\"}"), t).message).toBe("send.sessionTimedOut");
    const fromServer = (msg: string) => Object.assign(new Error(msg), { status: 400 });
    expect(mapSendError(fromServer("From address does not match this key"), t).message).toBe("send.intentMismatch");
    expect(mapSendError(fromServer("BTC sighash does not match transaction"), t).message).toBe("send.intentMismatch");
    // A local "mismatch" (not the server refusing the bytes) is not claimed as an intent mismatch.
    expect(mapSendError(new Error("length mismatch"), t).message).toBe("alert.error");
    expect(mapSendError(new Error("insufficient funds for gas * price + value"), t).message).toBe("send.insufficientWithFee");
  });

  test("localised errors pass through; unknown errors are generic with details", () => {
    expect(mapSendError(new LocalizedSendError("Too many inputs"), t)).toEqual({ kind: "error", message: "Too many inputs" });
    expect(mapSendError(new Error("Error: weird thing"), t)).toEqual({ kind: "error", message: "alert.error", detail: "weird thing" });
  });
});
