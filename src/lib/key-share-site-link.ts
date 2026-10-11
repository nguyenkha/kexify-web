import i18n from "../i18n/i18n";
import { apiUrl } from "./apiBase";
import { authHeaders } from "./auth";

/**
 * Tell the server this wallet now lives on this site too. Each domain lists only
 * wallets created on it or linked to it, so an imported key file has to be linked
 * before it shows up. Idempotent.
 *
 * Throws when the server does not know the wallet (404) or it belongs to another
 * account (403) — e.g. an old key file from a wallet that no longer exists. Network
 * failures and missing sessions (recovery mode) are ignored: the client share is
 * already saved and the import can be retried.
 */
export async function linkKeyShareToSite(keyId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/keys/${keyId}/link`), { method: "POST", headers: authHeaders() });
  } catch {
    return;
  }
  if (res.status === 404 || res.status === 403) {
    throw new Error(i18n.t("recovery.keyFileNotOnAccount", { id: keyId.slice(0, 8) }));
  }
}
