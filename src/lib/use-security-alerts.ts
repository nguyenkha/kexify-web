// Security alerts feed, shared by every component that shows it (one poll for the app): loads when the first
// one mounts, every 60 s while the tab is visible (paused while hidden), when it comes back, and after mark-read.
import { useEffect, useSyncExternalStore } from "react";
import { getToken } from "./auth";
import { isRecoveryMode } from "./recovery";
import { ALERTS_CHANGED_EVENT, listAlerts, type SecurityAlert } from "./security-alerts-api";

const POLL_MS = 60_000;
type State = { alerts: SecurityAlert[] | null; unread: number; failed: boolean };

let state: State = { alerts: null, unread: 0, failed: false };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export async function refreshSecurityAlerts(): Promise<void> {
  if (isRecoveryMode() || !getToken()) return;
  try {
    const out = await listAlerts();
    set({ alerts: out.alerts ?? [], unread: Number(out.unread) || 0, failed: false });
  } catch {
    set({ ...state, failed: true }); // offline or older server: keep what we have
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = document.visibilityState === "visible" ? setInterval(() => void refreshSecurityAlerts(), POLL_MS) : null;
}
function onVisible() {
  schedule();
  if (document.visibilityState === "visible") void refreshSecurityAlerts();
}
const onChanged = () => void refreshSecurityAlerts();

function start() {
  if (users++ > 0) return;
  void refreshSecurityAlerts();
  schedule();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener(ALERTS_CHANGED_EVENT, onChanged);
}
function stop() {
  if (--users > 0) return;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener(ALERTS_CHANGED_EVENT, onChanged);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useSecurityAlerts(): State {
  useEffect(() => { start(); return stop; }, []);
  return useSyncExternalStore(subscribe, () => state);
}
