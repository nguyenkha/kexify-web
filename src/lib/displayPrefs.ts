const DISPLAY_PREFIX = "display:";

/** Get stored display map for a key. Returns null if never set. */
export function getStoredDisplay(keyId: string): Record<string, boolean> | null {
  try {
    const raw = localStorage.getItem(DISPLAY_PREFIX + keyId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Save display map for a key */
export function setStoredDisplay(keyId: string, vis: Record<string, boolean>) {
  localStorage.setItem(DISPLAY_PREFIX + keyId, JSON.stringify(vis));
}

/** Determine if a chain row should be visible */
export function isChainVisible(
  chainName: string,
  stored: Record<string, boolean> | null,
  defaults: string[] | null,
): boolean {
  const key = `chain:${chainName}`;
  if (stored && key in stored) return stored[key];
  if (defaults) return defaults.includes(chainName);
  return true;
}

/** Determine if a token sub-row should be visible */
export function isTokenVisible(
  assetId: string,
  stored: Record<string, boolean> | null,
  balance: string | null,
): boolean {
  if (stored && assetId in stored) return stored[assetId];
  if (balance === null) return false;
  return parseFloat(balance) > 0;
}
