import { apiUrl } from "./apiBase";

const TOKEN_KEY = "secretkey_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Safely parse JSON from a response, returning null if not JSON */
async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function requestMagicLink(email: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/auth/request"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error("Server unreachable. Check your connection.");
  }
  if (!res.ok) {
    const data = await safeJson(res);
    throw new Error((data?.error as string) || "Failed to request magic link");
  }
}

export async function verifyToken(token: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/auth/verify?token=${token}`));
  } catch {
    throw new Error("Server unreachable. Check your connection.");
  }
  if (!res.ok) {
    const data = await safeJson(res);
    throw new Error((data?.error as string) || "Verification failed");
  }
  const data = await safeJson(res);
  if (!data?.token) throw new Error("Invalid server response");
  return data.token as string;
}

export async function verifyCode(email: string, code: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/auth/verify-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
  } catch {
    throw new Error("Server unreachable. Check your connection.");
  }
  if (!res.ok) {
    const data = await safeJson(res);
    throw new Error((data?.error as string) || "Code verification failed");
  }
  const data = await safeJson(res);
  if (!data?.token) throw new Error("Invalid server response");
  return data.token as string;
}

export interface MeUser {
  id: string;
  email: string;
  frozenAt: string | null;
  unfreezeAt: string | null;
}

export async function getMe(): Promise<MeUser | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // Only clear token on auth failures (401/403), not on server errors
      if (res.status === 401 || res.status === 403) clearToken();
      return null;
    }
    const data = await safeJson(res);
    return (data?.user as MeUser) ?? null;
  } catch {
    // Network error (server unreachable) — don't clear token
    return null;
  }
}
