// Premium entitlement + stablecoin payment client (API: GET /entitlement, /payments/crypto/*).
import { apiUrl } from "./apiBase";
import { authHeaders } from "./auth";

export type PremiumProduct = "monthly" | "yearly";
export type CryptoChain = "base" | "solana" | "tron";
export type CryptoToken = "USDC" | "USDT";

export interface Entitlement {
  plan: "free" | "premium";
  state: "none" | "active" | "grace" | "expired";
  expiresAt: string | null;
  graceUntil: string | null;
  apple: { expiresAt: string | null; autoRenew: boolean; environment: string } | null;
  crypto: { expiresAt: string } | null;
}

export interface EntitlementInfo {
  entitlement: Entitlement;
  owner: { kind: "user" | "key_share" };
  products: Record<PremiumProduct, { priceUsd: string; days: number }>;
  apple: { enabled: boolean };
  crypto: { enabled: boolean };
}

export interface CryptoMethod { chain: CryptoChain; token: CryptoToken; contract: string; treasury: string }
export interface CryptoOptions {
  enabled: boolean;
  network: "mainnet" | "testnet";
  methods: CryptoMethod[];
  reference: string | null;
  intentTtlHours: number;
}

export interface CryptoIntent {
  id: string;
  product: PremiumProduct;
  network: string;
  chain: CryptoChain;
  token: CryptoToken;
  contract: string;
  treasury: string;
  amount: string;
  status: "open" | "credited" | "expired";
  txHash: string | null;
  createdAt: string;
  expiresAt: string;
  creditedAt: string | null;
}

export type ApiFailure = { ok: false; status: number; code: string; message: string; received?: string | null };
export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;
export type ClaimResult =
  | { ok: true; status: "credited"; intent: CryptoIntent; entitlement: Entitlement }
  | { ok: true; status: "confirming" }
  | ApiFailure;

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> | null } | ApiFailure> {
  try {
    const res = await fetch(apiUrl(`/api${path}`), {
      method,
      headers: { ...authHeaders(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data: Record<string, unknown> | null = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    return { status: res.status, data };
  } catch {
    return { ok: false, status: 0, code: "network", message: "network" };
  }
}

function failure(status: number, data: Record<string, unknown> | null): ApiFailure {
  const code = typeof data?.code === "string" ? data.code : status === 400 ? "bad_request" : status === 401 ? "unauthorized" : "unknown";
  const received = typeof data?.received === "string" ? data.received : undefined;
  return { ok: false, status, code, message: typeof data?.error === "string" ? data.error : code, ...(received !== undefined && { received }) };
}

async function getJson<T>(path: string): Promise<ApiResult<{ data: T }>> {
  const r = await call("GET", path);
  if ("ok" in r) return r;
  return r.status === 200 && r.data ? { ok: true, data: r.data as T } : failure(r.status, r.data);
}

export const getEntitlement = () => getJson<EntitlementInfo>("/entitlement");
export const getCryptoOptions = () => getJson<CryptoOptions>("/payments/crypto/options");

export async function listCryptoIntents(): Promise<ApiResult<{ intents: CryptoIntent[] }>> {
  const r = await getJson<{ intents: CryptoIntent[] }>("/payments/crypto/intents");
  return r.ok ? { ok: true, intents: r.data.intents } : r;
}

export async function createCryptoIntent(input: { product: PremiumProduct; chain: CryptoChain; token: CryptoToken }): Promise<ApiResult<{ intent: CryptoIntent; reference: string }>> {
  const r = await call("POST", "/payments/crypto/intents", input);
  if ("ok" in r) return r;
  if ((r.status === 200 || r.status === 201) && r.data?.intent) {
    return { ok: true, intent: r.data.intent as CryptoIntent, reference: String(r.data.reference ?? "") };
  }
  return failure(r.status, r.data);
}

export async function claimCryptoIntent(id: string, txHash: string): Promise<ClaimResult> {
  const r = await call("POST", `/payments/crypto/intents/${encodeURIComponent(id)}/claim`, { txHash: txHash.trim() });
  if ("ok" in r) return r;
  if (r.status === 202) return { ok: true, status: "confirming" };
  if (r.status === 200 && r.data?.status === "credited") {
    return { ok: true, status: "credited", intent: r.data.intent as CryptoIntent, entitlement: r.data.entitlement as Entitlement };
  }
  return failure(r.status, r.data);
}
