// Network side of the verifiable (PVE) server-share export; see pve-server-share.ts.

import { getMpcInstance, toBase64 } from "./mpc";
import { apiUrl } from "./apiBase";
import { sensitiveHeaders } from "./passkey";
import type { KeyFileData } from "./crypto";
import { sealPveExport, type PveSharePayload } from "./pve-server-share";
/**
 * Request a PVE export of the server share and verify it. Returns the peer-2 key file
 * (unencrypted; the caller encrypts it with the user's passphrase before saving) and
 * whether it was test-restored against the client share (`clientFile`) or only checked
 * against the server's own claim.
 */
export async function requestPveServerExport(
  keyId: string,
  clientFile?: KeyFileData | null,
): Promise<{ file: KeyFileData; fullyVerified: boolean }> {
  const mpc = await getMpcInstance();
  const { ek, dk } = mpc.pveGenerateKeypair();
  try {
    const res = await fetch(apiUrl(`/api/keys/${keyId}/backup/server-share-pve`), {
      method: "POST",
      headers: { ...sensitiveHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ek: toBase64(ek) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Export failed");

    const fullyVerified = !!clientFile && (!data.share || !!clientFile.share) && (!data.eddsaShare || !!clientFile.eddsaShare);
    const seal = (payload: unknown, kind: "ecdsa" | "eddsa", clientShare?: string) =>
      payload ? sealPveExport(mpc, payload as PveSharePayload, ek, dk, keyId, kind, fullyVerified ? clientShare : undefined) : "";

    return {
      fullyVerified,
      file: {
        id: keyId,
        peer: 2,
        share: seal(data.share, "ecdsa", clientFile?.share),
        publicKey: data.publicKey,
        eddsaShare: seal(data.eddsaShare, "eddsa", clientFile?.eddsaShare),
        eddsaPublicKey: data.eddsaPublicKey,
      },
    };
  } finally {
    dk.fill(0);
  }
}
