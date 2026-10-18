// Scam-site check for WalletConnect (same source and rules as the iOS browser, DappSiteSafety.swift +
// KexifyCore PhishingList): MetaMask's public eth-phishing-detect list, served by our API (`/dapps/blocklist`) and
// checked in the browser, so the sites a user connects to are never sent anywhere. A listed domain blocks itself and
// its subdomains unless the list's whitelist names it; a site in kexify's signed dApp directory is never blocked.

import { apiUrl } from "./apiBase";
import { fetchDirectory } from "./dapp-directory";

export interface PhishingList {
  blacklist: Set<string>;
  whitelist: Set<string>;
}

/** The real list has ~100k entries: a smaller answer is truncated or hostile and is not used (iOS: same floor). */
export const MIN_LIST_SIZE = 10_000;

/** `{blacklist: [...], whitelist: [...]}` (other keys ignored); null when unreadable or empty. */
export function parsePhishingList(json: unknown): PhishingList | null {
  const o = json as { blacklist?: unknown; whitelist?: unknown } | null;
  if (!o || !Array.isArray(o.blacklist) || o.blacklist.length === 0) return null;
  const lower = (a: unknown) =>
    new Set((Array.isArray(a) ? a : []).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()));
  return { blacklist: lower(o.blacklist), whitelist: lower(o.whitelist) };
}

/** `a.b.example.com` -> [a.b.example.com, b.example.com, example.com] (never a bare TLD). */
export function hostSuffixes(host: string): string[] {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return [labels.join(".")];
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
}

/** `trusted`: hosts of kexify's signed directory, never blocked by the public list. */
export function isBlockedHost(host: string, list: PhishingList, trusted: string[] = []): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (trusted.includes(h)) return false;
  const suffixes = hostSuffixes(h);
  if (suffixes.some((s) => list.whitelist.has(s))) return false;
  return suffixes.some((s) => list.blacklist.has(s));
}

/** Host of a dApp URL as WalletConnect metadata gives it ("https://app.x.org/path", sometimes a bare host). */
export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

let listPromise: Promise<PhishingList | null> | null = null;
let trustedPromise: Promise<string[]> | null = null;

/** Downloaded once per page load (API and browser cache it for 6 h); a failed download is retried on the next check. */
function loadList(): Promise<PhishingList | null> {
  listPromise ??= fetch(apiUrl("/api/dapps/blocklist"))
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const list = parsePhishingList(j);
      return list && list.blacklist.size >= MIN_LIST_SIZE ? list : null;
    })
    .catch(() => null)
    .then((list) => {
      if (!list) listPromise = null;
      return list;
    });
  return listPromise;
}

function loadTrusted(): Promise<string[]> {
  trustedPromise ??= fetchDirectory()
    .then((d) => d.apps.map((a) => hostOf(a.url)).filter((h): h is string => !!h))
    .catch(() => {
      trustedPromise = null;
      return [];
    });
  return trustedPromise;
}

/** The first of `urls` whose host is on the phishing list, or null (none listed, or the list is unavailable). */
export async function findPhishingHost(urls: (string | undefined | null)[]): Promise<string | null> {
  const hosts = [...new Set(urls.map(hostOf).filter((h): h is string => !!h))];
  if (hosts.length === 0) return null;
  const [list, trusted] = await Promise.all([loadList(), loadTrusted()]);
  if (!list) return null;
  return hosts.find((h) => isBlockedHost(h, list, trusted)) ?? null;
}
