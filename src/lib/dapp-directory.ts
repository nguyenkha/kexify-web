// kexify's curated dApp directory (same signed list as the iOS Khám phá tab). Signed offline with Ed25519
// (api/scripts/sign-dapp-directory.ts): only a payload whose signature verifies with the pinned key is shown, so
// neither the API nor the network can add an entry or change where one points.
import { ed25519 } from "@noble/curves/ed25519.js";
import { apiUrl } from "./apiBase";

/** Same key as ios/KexifyCore/Sources/KexifyCore/DappDirectory.swift (the API test checks both). */
export const DIRECTORY_PUBLIC_KEY = "J3SRx/LEJAdv6gMBfrtKtkBBbZ5LExbwi/UJ/GH4f0c=";

export interface DirectoryApp {
  id: string;
  name: string;
  url: string;
  category: string;
  chains: string[];
  description: Record<string, string>;
}

export interface DappDirectory {
  serial: number;
  updatedAt: string;
  categories: string[];
  featured: DirectoryApp[];
  apps: DirectoryApp[];
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Parses `{payload, signature}`; throws unless the signature verifies. Entries that are not a bare https origin
 *  are dropped. */
export function verifyDirectory(envelope: unknown, publicKey = DIRECTORY_PUBLIC_KEY): DappDirectory {
  const e = envelope as { payload?: unknown; signature?: unknown };
  if (typeof e?.payload !== "string" || typeof e.signature !== "string") throw new Error("bad directory envelope");
  const ok = ed25519.verify(b64(e.signature), new TextEncoder().encode(e.payload), b64(publicKey));
  if (!ok) throw new Error("directory signature does not verify");
  const raw = JSON.parse(e.payload);
  if (raw?.version !== 1 || !Array.isArray(raw.apps)) throw new Error("unsupported directory");
  const apps: DirectoryApp[] = raw.apps.filter((a: DirectoryApp) => {
    try { const u = new URL(a.url); return u.protocol === "https:" && a.url === u.origin; } catch { return false; }
  });
  const byId = new Map(apps.map((a) => [a.id, a]));
  return {
    serial: Number(raw.serial) || 0,
    updatedAt: String(raw.updatedAt ?? ""),
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    featured: (raw.featured ?? []).map((id: string) => byId.get(id)).filter(Boolean),
    apps,
  };
}

export async function fetchDirectory(): Promise<DappDirectory> {
  const res = await fetch(apiUrl("/api/dapps/directory"));
  if (!res.ok) throw new Error(`directory: HTTP ${res.status}`);
  return verifyDirectory(await res.json());
}

export const appDescription = (a: DirectoryApp, lang: string) => a.description[lang.startsWith("vi") ? "vi" : "en"] ?? a.description.en ?? "";
