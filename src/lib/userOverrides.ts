// Per-user config overrides stored in localStorage

export interface ChainOverride {
  rpcUrl?: string;
  explorerUrl?: string;
}

export interface CustomToken {
  id: string;           // "custom:{chainId}:{contractAddress}"
  symbol: string;
  name: string;
  decimals: number;
  contractAddress: string;
  iconUrl: string | null;
  chainId: string;
  addedAt: number;      // timestamp
}

export interface UserOverrides {
  chains?: Record<string, ChainOverride>;
  customTokens?: CustomToken[];
  preferences?: {
    refresh_interval?: number;
    default_chains?: string[];
    show_testnet?: boolean;
    expert_mode?: boolean;
    evm_gas_buffer_pct?: number;
    confirm_before_broadcast?: boolean;
    [key: string]: unknown;
  };
}

function storageKey(userId?: string): string {
  return userId ? `kexify:config:${userId}` : "kexify:config";
}

export function getUserOverrides(userId?: string): UserOverrides {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function setUserOverrides(overrides: UserOverrides, userId?: string): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(overrides));
}

export function clearUserOverrides(userId?: string): void {
  localStorage.removeItem(storageKey(userId));
}

/** Get all custom tokens from any user override entry */
export function getCustomTokens(): CustomToken[] {
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("kexify:config:")) {
      try {
        const parsed = JSON.parse(localStorage.getItem(k)!) as UserOverrides;
        if (parsed.customTokens?.length) return parsed.customTokens;
      } catch { /* skip */ }
    }
  }
  return [];
}

// Preferences that only take effect in expert mode — return undefined (default) when non-expert
const EXPERT_ONLY_PREFS: Set<string> = new Set([
  "confirm_before_broadcast",
  "evm_gas_buffer_pct",
]);

/** Get a preference value from any user override entry (scans localStorage if no userId).
 *  Expert-only preferences return undefined when expert_mode is off. */
export function getPreference<K extends keyof NonNullable<UserOverrides["preferences"]>>(
  key: K,
  userId?: string,
): NonNullable<UserOverrides["preferences"]>[K] | undefined {
  // Find the overrides (by userId or scanning)
  let overrides: UserOverrides | null = null;
  if (userId) {
    overrides = getUserOverrides(userId);
  } else {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("kexify:config:")) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k)!) as UserOverrides;
          if (parsed.preferences?.[key] !== undefined) { overrides = parsed; break; }
        } catch { /* skip */ }
      }
    }
  }
  if (!overrides) return undefined;

  // Expert-only prefs: return undefined when expert mode is off
  if (EXPERT_ONLY_PREFS.has(key as string) && !overrides.preferences?.expert_mode) {
    return undefined;
  }

  return overrides.preferences?.[key] as any;
}
