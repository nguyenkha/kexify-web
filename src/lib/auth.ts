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

export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch(apiUrl("/api/auth/request"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to request magic link");
  }
}

export async function verifyToken(token: string): Promise<string> {
  const res = await fetch(apiUrl(`/api/auth/verify?token=${token}`));
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Verification failed");
  }
  const data = await res.json();
  return data.token; // JWT
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

  const res = await fetch(apiUrl("/api/auth/me"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    clearToken();
    return null;
  }
  const data = await res.json();
  return data.user;
}
