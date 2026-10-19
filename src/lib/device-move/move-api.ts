// HTTP calls of the QR device move (/api/transfers/*). The new device may call before any login.
import { apiUrl } from "../apiBase";
import { authHeaders } from "../auth";
import { handleSessionEnded } from "../session-ended";

export class MoveApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly releaseAt?: string;
  constructor(status: number, code: string, releaseAt?: string) {
    super(code);
    this.name = "MoveApiError";
    this.status = status;
    this.code = code;
    this.releaseAt = releaseAt;
  }
}

export interface TransferView {
  transferId: string; devicePubkey: string; kind: string; ephPubkey: string; nonce: string;
  status: string; expiresAt: string; fingerprint: string;
  device: { label: string | null; platform: string | null; country: string | null; loginAt: string | null };
}

export interface ClaimResult {
  keyShareId: string; signerId: string; ciphertext: string; senderEphPubkey: string; shareGeneration: number;
  session?: { token: string; refreshToken: string };
}

async function call<T>(path: string, method: "GET" | "POST", body?: unknown, headers: Record<string, string> = authHeaders()): Promise<T> {
  const res = await fetch(apiUrl(`/api/transfers${path}`), {
    method,
    credentials: "include", // the anonymous claim sets the kxi_refresh cookie (cross-origin API)
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleSessionEnded(res.status, data?.code);
    throw new MoveApiError(res.status, String(data?.code ?? data?.error ?? res.status), typeof data?.releaseAt === "string" ? data.releaseAt : undefined);
  }
  return data as T;
}

const id = (transferId: string) => `/${encodeURIComponent(transferId)}`;

/** New device: open a move (Authorization only when signed in). */
export const openTransfer = (devicePubkey: string, ephPubkey: string) =>
  call<{ transferId: string; nonce: string; expiresAt: string; fingerprint: string }>("", "POST", { devicePubkey, kind: "web_webcrypto", ephPubkey });

export const transferStatus = (transferId: string) =>
  call<{ status: "open" | "approved" | "claimed" | "rejected"; releaseAt: string | null; keyShareId: string | null }>(`${id(transferId)}/status`, "GET");

export const claimTransfer = (transferId: string, sig: string, code?: string) =>
  call<ClaimResult>(`${id(transferId)}/claim`, "POST", code ? { sig, code } : { sig });

/** Old device: what the server holds for the QR's transfer. */
export const getTransfer = (transferId: string) => call<TransferView>(id(transferId), "GET");

/** Old device without a camera: this account's open moves. */
export const listOpenTransfers = () => call<{ transfers: TransferView[] }>("", "GET").then((r) => r.transfers);

export interface SignerAuth { by: string; nonce: string; sig: string }

export const approveTransfer = (transferId: string, body: SignerAuth & {
  keyShareId: string; ciphertext: string; senderEphPubkey: string; code: string; generation: number;
}, headers: Record<string, string>) => call<{ ok: boolean; signerId: string; releaseAt: string }>(`${id(transferId)}/approve`, "POST", body, headers);

export const rejectTransfer = (transferId: string, body: SignerAuth & { keyShareId: string }, headers: Record<string, string>) =>
  call<{ ok: boolean; frozen?: boolean }>(`${id(transferId)}/reject`, "POST", body, headers);
