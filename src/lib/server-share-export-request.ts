/**
 * Server-share export delay: an export is requested first and unlocks after the cooling
 * period (the owner is emailed, and freezing stops it). The export endpoints answer 409
 * until then; this turns that into a scheduled request the UI can show and cancel.
 */
import { apiUrl } from "./apiBase";
import { authHeaders } from "./auth";
import { sensitiveHeaders, fetchWithPasskey } from "./passkey";

/** Requesting or cancelling the export failed; the UI shows its own translated text. */
export class ExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRequestError";
  }
}

/**
 * No export is scheduled (or the last one lapsed or was cancelled elsewhere). Scheduling is
 * its own passkey tap, so the UI asks for a fresh click instead of prompting after a 409.
 */
export class ExportNotRequestedError extends Error {
  constructor() {
    super("Export not requested");
    this.name = "ExportNotRequestedError";
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
 * Call with a failed export response. A 409 means no export is unlocked yet: throw
 * ExportNotReadyError (scheduled) or ExportNotRequestedError (none). Returns otherwise.
 */
export async function throwIfExportGated(res: Response): Promise<void> {
  if (res.status !== 409) return;
  const data = await res.clone().json().catch(() => ({})) as { code?: string; readyAt?: string };
  if (data.code === "EXPORT_NOT_READY" && data.readyAt) throw new ExportNotReadyError(data.readyAt);
  if (data.code === "EXPORT_NOT_REQUESTED") throw new ExportNotRequestedError();
}

/**
 * Schedule a server-share export (its own passkey tap, bound to "export.request") and throw
 * ExportNotReadyError with its ready time. Call it from the click when the key has no request,
 * so the export does not cost an extra prompt after a 409.
 */
export async function requestServerShareExport(keyId: string): Promise<never> {
  const req = await fetchWithPasskey(apiUrl(`/api/keys/${encodeURIComponent(keyId)}/backup/server-share-request`), {
    method: "POST",
    headers: sensitiveHeaders(),
  }, { action: "export.request", keyShareId: keyId });
  const body = await req.json().catch(() => ({})) as { readyAt?: string; error?: string };
  if (!req.ok || !body.readyAt) throw new ExportRequestError(body.error || "request failed");
  throw new ExportNotReadyError(body.readyAt);
}

export async function cancelServerShareExport(keyId: string): Promise<void> {
  const res = await fetchWithPasskey(apiUrl(`/api/keys/${encodeURIComponent(keyId)}/backup/server-share-request`), {
    method: "DELETE",
    headers: authHeaders(),
  }, { action: "export.request-cancel", keyShareId: keyId });
  if (!res.ok) throw new ExportRequestError("cancel failed");
}
