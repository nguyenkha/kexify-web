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

export interface AddressBookEntry {
  address: string;
  label: string;
  chain?: string;
  addedAt: number;
}

export interface RecentRecipientEntry {
  address: string;
  chain: string;
  asset: string;
  timestamp: number;
}

export interface UserOverrides {
  chains?: Record<string, ChainOverride>;
  customTokens?: CustomToken[];
  addressBook?: AddressBookEntry[];
  recentRecipients?: RecentRecipientEntry[];
  hideBalances?: boolean;
  display?: Record<string, Record<string, boolean>>;
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

/** Extract userId from JWT in localStorage (synchronous, no network call) */
function currentUserId(): string | undefined {
  try {
    const token = localStorage.getItem("secretkey_token");
    if (!token) return undefined;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub;
  } catch { return undefined; }
}

/** Find the current user's overrides — by userId, JWT, or scanning localStorage */
function findOverrides(userId?: string): UserOverrides {
  // 1. Explicit userId
  if (userId) return getUserOverrides(userId);
  // 2. Derive from JWT token
  const jwtId = currentUserId();
  if (jwtId) return getUserOverrides(jwtId);
  // 3. Fallback: scan localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("kexify:config:")) {
      try { return JSON.parse(localStorage.getItem(k)!) as UserOverrides; } catch { /* skip */ }
    }
  }
  return {};
}

/** Apply chain overrides (RPC/explorer URL) — only in expert mode */
export function applyChainOverrides<T extends { name: string; rpcUrl: string; explorerUrl: string }>(
  chains: T[],
  userId?: string,
): T[] {
  const overrides = findOverrides(userId);
  if (!overrides.preferences?.expert_mode) return chains;
  return chains.map(ch => {
    const o = overrides.chains?.[ch.name];
    if (!o) return ch;
    return { ...ch, ...(o.rpcUrl ? { rpcUrl: o.rpcUrl } : {}), ...(o.explorerUrl ? { explorerUrl: o.explorerUrl } : {}) };
  });
}

/** Get all custom tokens from any user override entry */
export function getCustomTokens(): CustomToken[] {
  const overrides = findOverrides();
  return overrides.customTokens ?? [];
}

// Expert-only preferences: return their default value when expert_mode is off,
// regardless of what is stored in localStorage.
const EXPERT_PREF_DEFAULTS: Partial<Record<string, unknown>> = {
  show_testnet: false,
  confirm_before_broadcast: false,
  evm_gas_buffer_pct: 10,
};

/** Get a preference value, gated by expert mode for expert-only preferences.
 *  When expert_mode is off, expert-only prefs return their default value. */
export function getPreference<K extends keyof NonNullable<UserOverrides["preferences"]>>(
  key: K,
  userId?: string,
): NonNullable<UserOverrides["preferences"]>[K] {
  const overrides = findOverrides(userId);
  const defaultVal = EXPERT_PREF_DEFAULTS[key as string];
  const isExpertOnly = key as string in EXPERT_PREF_DEFAULTS;

  // Expert-only prefs: return default when expert mode is off
  if (isExpertOnly && !overrides.preferences?.expert_mode) {
    return defaultVal as NonNullable<UserOverrides["preferences"]>[K];
  }

  return (overrides.preferences?.[key] ?? defaultVal) as NonNullable<UserOverrides["preferences"]>[K];
}
