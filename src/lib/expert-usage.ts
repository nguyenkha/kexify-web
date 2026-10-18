// Anonymous Expert-tool usage counter (api: routes/usage.ts). Sends the event name only: no
// address, user id or auth header. Fire-and-forget; a failure never reaches the user.
import { apiUrl } from "./apiBase";

export type ExpertEvent =
  | "expert_enabled" | "raw_sign" | "raw_broadcast" | "send_custom_fee" | "send_custom_nonce"
  | "send_manual_utxo" | "speed_up" | "audit_detail" | "config_json" | "config_networks"
  | "config_testnet" | "config_confirm_broadcast" | "config_gas_buffer" | "policy_rules"
  | "key_share_manager";

const seen = new Set<ExpertEvent>();

/** Once per page load, for events that fire repeatedly (typing, toggling). */
export function trackExpertToolOnce(event: ExpertEvent): void {
  if (seen.has(event)) return;
  seen.add(event);
  trackExpertTool(event);
}

export function trackExpertTool(event: ExpertEvent): void {
  try {
    void fetch(apiUrl("/api/usage/event"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      credentials: "omit",
      referrerPolicy: "no-referrer", // the page URL can carry an account id
      keepalive: true,
    }).catch(() => {});
  } catch { /* counting is best-effort */ }
}
