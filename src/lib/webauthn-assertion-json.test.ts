import { describe, expect, test } from "bun:test";
import { splitAssertion } from "./webauthn-assertion-json";

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill).buffer;

function fakeAssertion(prf: BufferSource) {
  return {
    id: "cred", rawId: bytes(16, 1), type: "public-key", authenticatorAttachment: "platform",
    response: { authenticatorData: bytes(37, 2), clientDataJSON: bytes(40, 3), signature: bytes(70, 4), userHandle: null },
    getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: prf } } }),
  } as unknown as PublicKeyCredential;
}

describe("splitAssertion", () => {
  for (const [name, prf] of [["ArrayBuffer", bytes(32, 0xab)], ["Uint8Array", new Uint8Array(32).fill(0xab)]] as const) {
    test(`the serialized payload never carries PRF output (${name})`, () => {
      const { credential, prfOutput } = splitAssertion(fakeAssertion(prf));
      const json = JSON.stringify({ challengeId: "c", credential });
      expect(prfOutput).toBe(prf);
      // 0xab bytes in any encoding: raw numbers (typed array JSON), base64url, hex
      expect(json).not.toContain("171");
      expect(json).not.toContain("q6ur");
      expect(json.toLowerCase()).not.toContain("abab");
      expect(credential.clientExtensionResults).toEqual({});
    });
  }
});
