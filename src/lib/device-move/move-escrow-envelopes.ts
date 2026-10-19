// Backup of the new copy after a refresh (POST /keys/:id/share-refresh/backup). Each envelope is the same
// stored-share blob the normal backup upload sends. credentialId "slot" = this site's backup slot: the
// server names it (slot:legacy / slot:<rpId>), so the client never guesses the RP.

export interface EscrowEnvelope { credentialId: string; rpId?: string | null; encryptedData: string }

export const SITE_SLOT = "slot";

/**
 * The envelopes for one sealed blob: the passkey's own (PRF, with its RP) or the backup password's
 * (credentialId "passphrase"), plus the site slot copy.
 */
export function envelopesFor(sealed: string, credentialId: string, rpId: string | undefined): EscrowEnvelope[] {
  const own: EscrowEnvelope = credentialId === "passphrase"
    ? { credentialId, encryptedData: sealed }
    : { credentialId, rpId: rpId ?? null, encryptedData: sealed };
  return [own, { credentialId: SITE_SLOT, encryptedData: sealed }];
}

/** The exact string that is uploaded and hashed into the backup signature. */
export const envelopesJson = (envelopes: EscrowEnvelope[]) => JSON.stringify(envelopes);
