/**
 * Server-share export delay: an export is requested first and unlocks after the cooling
 * period (the owner is emailed, and freezing stops it). The export endpoints answer 409
 * until then; this turns that into a scheduled request the UI can show and cancel.
 */
import { apiUrl } from "./apiBase";
import { authHeaders } from "./auth";
import { sensitiveHeaders, fetchWithPasskeyStepUp } from "./passkey";

/** Requesting or cancelling the export failed; the UI shows its own translated text. */
export class ExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRequestError";
  }
}

/** The export is scheduled; it can be downloaded from `readyAt`. */
export class ExportNotReadyError extends Error {
  readonly readyAt: string;
  constructor(readyAt: string) {
    super("Export not available yet");
    this.name = "ExportNotReadyError";
    this.readyAt = readyAt;
  }
}

/**
 * Call with a failed export response. A 409 means no export is unlocked yet: request one
 * if there is none, then throw ExportNotReadyError. Returns for any other failure.
 */
export async function throwIfExportGated(keyId: string, res: Response): Promise<void> {
  if (res.status !== 409) return;
  const data = await res.clone().json().catch(() => ({})) as { code?: string; readyAt?: string };
  if (data.code === "EXPORT_NOT_READY" && data.readyAt) throw new ExportNotReadyError(data.readyAt);
  if (data.code !== "EXPORT_NOT_REQUESTED") return;
  const req = await fetch(apiUrl(`/api/keys/${encodeURIComponent(keyId)}/backup/server-share-request`), {
    method: "POST",
    headers: { ...sensitiveHeaders(), "Content-Type": "application/json" },
  });
  const body = await req.json().catch(() => ({})) as { readyAt?: string; error?: string };
  if (!req.ok || !body.readyAt) throw new ExportRequestError(body.error || "request failed");
  throw new ExportNotReadyError(body.readyAt);
}

export async function cancelServerShareExport(keyId: string): Promise<void> {
  const res = await fetchWithPasskeyStepUp(apiUrl(`/api/keys/${encodeURIComponent(keyId)}/backup/server-share-request`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new ExportRequestError("cancel failed");
}
