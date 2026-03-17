import { getUserOverrides, setUserOverrides } from "./userOverrides";

/** Get stored display map for a key. Returns null if never set. */
export function getStoredDisplay(keyId: string, userId?: string): Record<string, boolean> | null {
  const overrides = getUserOverrides(userId);
  return overrides.display?.[keyId] ?? null;
}

/** Save display map for a key */
export function setStoredDisplay(keyId: string, vis: Record<string, boolean>, userId?: string) {
  const overrides = getUserOverrides(userId);
  if (!overrides.display) overrides.display = {};
  overrides.display[keyId] = vis;
  setUserOverrides(overrides, userId);
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
  _balance: string | null,
): boolean {
  // Only show tokens explicitly enabled by user
  if (stored && assetId in stored) return stored[assetId];
  return false;
}

/** Check if a token has a stored decision (yes or no) */
export function hasTokenDecision(assetId: string, stored: Record<string, boolean> | null): boolean {
  return stored != null && assetId in stored;
}

/**
 * Find tokens with balance > 0 that the user hasn't made a decision about yet.
 * These are candidates for the "new token discovered" prompt.
 */
export function findNewTokens(
  balances: { asset: { id: string; symbol: string }; formatted: string }[],
  stored: Record<string, boolean> | null,
): { id: string; symbol: string; balance: string }[] {
  return balances
    .filter((b) => parseFloat(b.formatted) > 0 && !hasTokenDecision(b.asset.id, stored))
    .map((b) => ({ id: b.asset.id, symbol: b.asset.symbol, balance: b.formatted }));
}
