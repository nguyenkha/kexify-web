import { apiUrl } from "./apiBase";
import { authHeaders } from "./auth";

/**
 * Tell the server this wallet now lives on this site too. Each domain lists only
 * wallets created on it or linked to it, so an imported key file has to be linked
 * before it shows up. Idempotent; failures (offline, recovery mode with no session)
 * are ignored — the client share is already saved locally and linking can be retried
 * by importing again.
 */
export async function linkKeyShareToSite(keyId: string): Promise<void> {
  try {
    await fetch(apiUrl(`/api/keys/${keyId}/link`), { method: "POST", headers: authHeaders() });
  } catch {
    /* best effort */
  }
}
