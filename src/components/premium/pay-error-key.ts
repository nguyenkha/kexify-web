// Maps an API error code to its translation key; unknown codes fall back to a generic message.
const KNOWN = new Set([
  "network", "unauthorized", "crypto_payments_disabled", "busy", "bad_request", "tx_already_used", "already_paid",
  "intent_not_open", "intent_expired", "no_transfer", "too_early", "too_late", "underpaid", "amount_mismatch", "tx_failed", "provider_unavailable",
]);

export const payErrorKey = (code: string) => `premium.error.${KNOWN.has(code) ? code : "unknown"}`;
