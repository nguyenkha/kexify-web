// One passkey tap per signature request (audit F15).
//
// The assertion for /sign/init is bound to the key and the exact digest list. When the
// browser share is still PRF-encrypted (a deferred key file, see deferredPrfKeyFile), the
// same assertion also evaluates PRF and the share is decrypted here, so unlocking the
// share and authorizing the signature are one prompt.

import { sha256Hex, type PasskeyAction } from "./passkey";
import { authenticateWithTapFallback } from "./passkey-tap-prompt";
import { getKeySharePartsWithPrf, getKeyShareWithPrf } from "./keystore";
import { clientKeys, deferredPrfKeys, restoreKeyHandles, restoreKeyHandlesFromParts } from "./mpc";

export class PrfUnavailableError extends Error {
  constructor() {
    super("prf_unavailable");
    this.name = "PrfUnavailableError";
  }
}

/** Prompt for the passkey bound to this signature (base64 payloads as sent); returns the ticket. */
export async function authorizeSign(keyId: string, keyShareId: string, payloads: string[]): Promise<string> {
  const unlock = !clientKeys.has(keyId) && deferredPrfKeys.has(keyId);
  // An EdDSA payload is a whole message: the binding carries hashes, the server hashes the same strings.
  const action: PasskeyAction = { action: "sign", keyShareId, digests: await Promise.all(payloads.map(sha256Hex)) };
  // Building the tx may outlast the click's user activation: then a Confirm tap runs it.
  const { token, prfKey } = await authenticateWithTapFallback({ withPrf: unlock, action });
  if (unlock) {
    // No PRF from this ceremony (e.g. a provider that rejects PRF): the share stays locked.
    if (!prfKey) throw new PrfUnavailableError();
    await unlockDeferredShare(keyId, prfKey);
    // The passkey just used may not yet be able to restore this wallet: allow it silently (guarded, background).
    void import("./backup-passkey-allow").then((m) => m.allowOwnPasskeyAfterUnlock(keyShareId, keyId, prfKey));
  }
  if (!token) throw new Error("passkey_auth_required");
  return token;
}

/** Decrypt the PRF share straight into the key handles; the share never becomes a string. */
async function unlockDeferredShare(keyId: string, prfKey: CryptoKey): Promise<void> {
  let parts;
  try {
    parts = await getKeySharePartsWithPrf(keyId, prfKey);
  } catch {
    // A stored file the byte reader does not handle: fall back to the parsed key file.
    const data = await getKeyShareWithPrf(keyId, prfKey);
    if (!data) throw new Error("Could not decrypt the key share with this passkey");
    deferredPrfKeys.delete(keyId);
    await restoreKeyHandles(keyId, data.share, data.eddsaShare);
    return;
  }
  if (!parts) throw new Error("Could not decrypt the key share with this passkey");
  deferredPrfKeys.delete(keyId);
  await restoreKeyHandlesFromParts(keyId, parts.ecdsa, parts.eddsa);
}

/** Chains whose signer needs the EdDSA public key before the share is unlocked. */
export function chainUsesEddsa(chainType: string): boolean {
  return ["solana", "xlm", "ton", "algo", "ada"].includes(chainType);
}
