/**
 * Legacy-domain migration (kexify.co → kexify.app).
 *
 * Set VITE_MIGRATE_TO_URL only on the legacy build (app.kexify.co). When set, this
 * frontend stops creating new wallets and points users to the new domain instead.
 * Existing wallets keep working here: passkeys are bound to the domain they were
 * registered on, so a wallet cannot be moved across automatically.
 */
export const MIGRATE_TO_URL = (import.meta.env.VITE_MIGRATE_TO_URL as string | undefined) ?? "";

/** True on the legacy domain: keygen is closed and the migration notice is shown. */
export const KEYGEN_CLOSED = MIGRATE_TO_URL !== "";

/** Host shown to users, e.g. "my.kexify.app". */
export const MIGRATE_TO_HOST = KEYGEN_CLOSED ? new URL(MIGRATE_TO_URL).host : "";
