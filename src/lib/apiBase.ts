/**
 * API base URL for all backend requests.
 *
 * In development, Vite proxies /api → localhost:3000.
 * In production, set VITE_API_URL to the backend origin (e.g. "https://api.kexify.co").
 * If unset, requests use relative paths (same-origin).
 */
export const API_BASE = import.meta.env.VITE_API_URL ?? "";

/** Build a full API URL from a path like "/api/auth/me" */
export function apiUrl(path: string): string {
  // When cross-origin (API_BASE set), strip the /api prefix since the backend
  // is already a dedicated API domain (e.g. api.kexify.co/auth vs api.kexify.co/api/auth)
  const stripped = API_BASE ? path.replace(/^\/api/, "") : path;
  return `${API_BASE}${stripped}`;
}
