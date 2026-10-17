// The client share that signs for an account, resolved at the sign tap.
//
// Every account belongs to exactly one key share, so there is nothing to pick: the flow
// knows the keyId. A PRF share stays locked (the signing passkey unlocks it, one tap); a
// passphrase share asks for its passphrase here; recovery mode already holds the share.

import type { KeyFileData } from "./crypto";
import { deferredPrfKeyFile, getKeyShareMode, getKeyShareWithPrf } from "./keystore";
import { authenticatePasskey } from "./passkey";
import { requestKeyPassphrase } from "./key-passphrase-prompt";
import { getRecoveryKeyFile, isRecoveryMode } from "./recovery";

/** True when this device can sign for keyId without a key file upload. */
export function hasSigningShare(keyId: string): boolean {
  return isRecoveryMode() ? getRecoveryKeyFile() != null : getKeyShareMode(keyId) != null;
}

/**
 * The key file to sign with: an uploaded file when the user gave one, else the share this
 * device holds for keyId. Null when there is neither (the flow shows the upload instead).
 * Rejects with KeyPassphraseCancelled when the user dismisses the passphrase prompt.
 */
export async function resolveSigningKeyFile(
  keyId: string,
  opts: { needsEddsa: boolean; uploaded?: KeyFileData | null; owner?: object },
): Promise<KeyFileData | null> {
  if (opts.uploaded) return opts.uploaded;
  if (isRecoveryMode()) return getRecoveryKeyFile();
  const mode = getKeyShareMode(keyId);
  if (mode === "passphrase") return requestKeyPassphrase(keyId, opts.owner);
  if (mode !== "prf") return null;
  const deferred = deferredPrfKeyFile(keyId, { needsEddsa: opts.needsEddsa });
  if (deferred) return deferred;
  // An entry stored before its public keys were kept beside it: decrypt it up front.
  const { prfKey } = await authenticatePasskey({ withPrf: true });
  if (!prfKey) throw new Error("prf_unavailable");
  const data = await getKeyShareWithPrf(keyId, prfKey);
  if (!data) throw new Error("Could not decrypt the key share with this passkey");
  return data;
}
