// Turn a raw WebAuthn assertion into the JSON the server verifies, keeping the PRF output
// apart. The PRF result is the secret that decrypts the browser share: it must never be
// part of the object that is serialized and sent (a provider returning it as a typed array
// instead of an ArrayBuffer would otherwise put the raw bytes in the request body).

import { bufferToBase64URLString } from "@simplewebauthn/browser";

export interface AssertionJSON {
  id: string;
  rawId: string;
  response: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle?: string };
  type: string;
  clientExtensionResults: Record<string, never>;
  authenticatorAttachment: string | null;
}

/** prfOutput = PRF result for the first salt, prfSecond = for the second (escrow) salt; both stay out of `credential`. */
export function splitAssertion(raw: PublicKeyCredential): { credential: AssertionJSON; prfOutput?: BufferSource; prfSecond?: BufferSource } {
  const ext = raw.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource; second?: BufferSource } } };
  const response = raw.response as AuthenticatorAssertionResponse;
  const credential: AssertionJSON = {
    id: raw.id,
    rawId: bufferToBase64URLString(raw.rawId),
    response: {
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      signature: bufferToBase64URLString(response.signature),
      ...(response.userHandle ? { userHandle: bufferToBase64URLString(response.userHandle) } : {}),
    },
    type: raw.type,
    clientExtensionResults: {}, // the server needs none
    authenticatorAttachment: raw.authenticatorAttachment,
  };
  return { credential, prfOutput: ext.prf?.results?.first, prfSecond: ext.prf?.results?.second };
}
