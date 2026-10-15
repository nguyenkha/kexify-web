/**
 * Client-side browser Notification API wrapper.
 * User can toggle notifications on/off via localStorage flag.
 */

import { MASK, balancesHiddenNow } from "./hidden-amount";

const NOTIFY_ENABLED_KEY = "kxi:notifications_enabled";

/** Request notification permission. Call once on app init. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Check if notifications are enabled (browser permission + user toggle) */
export function isNotifyEnabled(): boolean {
  if (!("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  return localStorage.getItem(NOTIFY_ENABLED_KEY) !== "false";
}

/** Set user preference for notifications */
export function setNotifyEnabled(enabled: boolean): void {
  localStorage.setItem(NOTIFY_ENABLED_KEY, String(enabled));
}

interface NotifyOptions {
  title: string;
  body?: string;
  icon?: string;
  /** In-app path to navigate to when notification is clicked (e.g. "/accounts/key1/ethereum/ETH") */
  path?: string;
  /** Dedupe tag — same tag replaces previous notification instead of creating a new one */
  tag?: string;
}

/** With "hide balances" on, OS notifications must not show amounts (UX spec: home-assets.md).
 *  Callers mask what they know; this is the safety net for any number left in the body. */
function maskAmounts(body: string | undefined): string | undefined {
  if (!body || !balancesHiddenNow()) return body;
  return body.replace(/\b\d[\d.,]*/g, MASK);
}

/** Show a browser notification when enabled. Clicking navigates to `path` if provided.
 *  Uses `tag` to deduplicate — same tag replaces previous notification instead of stacking. */
export function notify({ title, body, icon, path, tag }: NotifyOptions): void {
  if (!isNotifyEnabled()) return;

  const n = new Notification(title, {
    body: maskAmounts(body),
    icon: icon || "/icon-192.png",
    tag,
  });

  n.onclick = () => {
    window.focus();
    if (path) {
      window.dispatchEvent(new CustomEvent("notify-navigate", { detail: path }));
    }
    n.close();
  };
}
