// Simple policy (3 settings) and scheduled sends: thin client over the API. The server compiles
// the settings into rules (the passkey ticket binds the hash of exactly that list) and decides
// whether a change applies at once (tighter) or after the 24 h cooling period.

import { authHeaders } from "./auth";
import { apiUrl } from "./apiBase";
import type { PolicyRuleBody } from "../shared/types";

export type OverLimit = "block" | "wait_1h" | "wait_24h";

export interface SimplePolicy {
  /** Decimal USD per rolling 24 h; null = no limit. */
  dailyLimitUsd: string | null;
  sendTo: "anywhere" | "trusted";
  trusted: string[];
  overLimit: OverLimit;
}

export interface CompiledPolicy {
  rules: PolicyRuleBody[];
  /** true = a tightening: applies as soon as it is submitted. */
  immediate: boolean;
}

export interface ScheduledSend {
  id: string;
  waitHours: number;
  readyAt: string;
  createdAt: string;
  summary: { chainType: string; to: string; amount: string; symbol: string | null } | null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(`/api/keys/${path}`), { ...init, headers: { ...authHeaders(), "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
  return data as T;
}

export function compileSimplePolicy(keyId: string, simple: SimplePolicy): Promise<CompiledPolicy> {
  return call(`${keyId}/rules/compile`, { method: "POST", body: JSON.stringify({ simple }) });
}

export async function listScheduledSends(keyId: string): Promise<ScheduledSend[]> {
  return (await call<{ scheduled: ScheduledSend[] }>(`${keyId}/scheduled-sends`)).scheduled;
}

/** `body` = the same description the policy pre-check takes (to, amount in base units, chain ...). */
export async function scheduleSend(keyId: string, body: Record<string, unknown>): Promise<ScheduledSend> {
  return (await call<{ scheduled: ScheduledSend }>(`${keyId}/scheduled-sends`, { method: "POST", body: JSON.stringify(body) })).scheduled;
}

export async function cancelScheduledSend(keyId: string, id: string): Promise<void> {
  await call(`${keyId}/scheduled-sends/${id}`, { method: "DELETE" });
}

/** Active simple settings of a key (null = Custom or no policy). */
export async function activeSimplePolicy(keyId: string): Promise<SimplePolicy | null> {
  try {
    return (await call<{ active?: { simple?: SimplePolicy | null } | null }>(`${keyId}/rules`)).active?.simple ?? null;
  } catch {
    return null;
  }
}

/** "Suggest the new simple policy" card: shown once per wallet until dismissed or applied. */
const DISMISS_KEY = (keyId: string) => `kexify:simple-policy-card-dismissed:${keyId}`;
export function isUpdateCardDismissed(keyId: string): boolean {
  try { return localStorage.getItem(DISMISS_KEY(keyId)) === "1"; } catch { return false; }
}
export function dismissUpdateCard(keyId: string): void {
  try { localStorage.setItem(DISMISS_KEY(keyId), "1"); } catch { /* private mode */ }
}
