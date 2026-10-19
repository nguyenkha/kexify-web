import { afterEach, describe, expect, test } from "bun:test";
import { loginAssertionWithEscrowKey } from "./passkey-login-assertion";
import { escrowPublicKey, escrowSecretFromPrf } from "./passkey-escrow-key";
import { b64 } from "./device-move/move-codec";

const buf = (n: number, fill: number) => new Uint8Array(n).fill(fill).buffer;
const options = { challenge: "AAAA", rpId: "app.kexify.co", allowCredentials: [] };
const nav = globalThis.navigator as unknown as { credentials?: unknown };
const saved = nav.credentials;
afterEach(() => { Object.defineProperty(globalThis.navigator, "credentials", { value: saved, configurable: true }); });

function stub(get: (o: CredentialRequestOptions) => Promise<unknown>) {
  Object.defineProperty(globalThis.navigator, "credentials", { value: { get }, configurable: true });
}
const assertion = (prf?: ArrayBuffer) => ({
  id: "cred", rawId: buf(16, 1), type: "public-key", authenticatorAttachment: "platform",
  response: { authenticatorData: buf(37, 2), clientDataJSON: buf(40, 3), signature: buf(70, 4), userHandle: null },
  getClientExtensionResults: () => (prf ? { prf: { results: { first: prf } } } : {}),
});

describe("passkey login assertion", () => {
  test("asks for the escrow salt and returns only the escrow public key", async () => {
    let seen: CredentialRequestOptions | undefined;
    stub(async (o) => { seen = o; return assertion(buf(32, 9)); });
    const out = await loginAssertionWithEscrowKey(options, false);
    const first = (seen!.publicKey!.extensions as { prf: { eval: { first: Uint8Array } } }).prf.eval.first;
    expect(new TextDecoder().decode(first)).toBe("kexify-escrow:v1");
    const want = escrowPublicKey(await escrowSecretFromPrf(new Uint8Array(32).fill(9)));
    expect(b64(out.escrowPublic!)).toBe(b64(want));
    expect(JSON.stringify(out.credential)).not.toContain("CQkJ"); // base64 of 0x09 bytes
  });

  test("a passkey without PRF still signs in, with no escrow key", async () => {
    stub(async () => assertion());
    expect((await loginAssertionWithEscrowKey(options, true)).escrowPublic).toBeUndefined();
  });

  for (const autofill of [false, true]) {
    test(`retries without PRF once when the request fails on it (autofill: ${autofill})`, async () => {
      let calls = 0;
      let mediation: string | undefined;
      stub(async (o) => { calls++; mediation = o.mediation; if (o.publicKey?.extensions) throw new Error("prf boom"); return assertion(); });
      const out = await loginAssertionWithEscrowKey(options, autofill);
      expect(calls).toBe(2);
      expect(out.escrowPublic).toBeUndefined();
      expect(mediation).toBe(autofill ? "conditional" : undefined);
    });
  }

  test("a dismissed prompt is not retried", async () => {
    let calls = 0;
    stub(async () => { calls++; throw Object.assign(new Error("x"), { name: "NotAllowedError" }); });
    await expect(loginAssertionWithEscrowKey(options, true)).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
