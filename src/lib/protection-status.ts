// Protection status per wallet (UX spec: onboarding-create-wallet.md "Protection status").
// A wallet is "fully protected" only once the user has created a passphrase-encrypted backup
// file (emergency kit) AND re-typed the passphrase to prove they saved it. The automatic PRF
// escrow does not count: losing the device and its passkey account together loses both.
// The flag is per browser (localStorage); there is no server field for it yet.

import { useEffect, useState } from "react";

const PREFIX = "kxi:kit-verified:";
const EVENT = "kxi:protection-changed";

export function isKitVerified(keyId: string): boolean {
  try {
    return !!localStorage.getItem(PREFIX + keyId);
  } catch {
    return false;
  }
}

/** Call after the user re-typed the passphrase of a backup file they just saved. */
export function markKitVerified(keyId: string): void {
  try {
    localStorage.setItem(PREFIX + keyId, new Date().toISOString());
  } catch {
    /* storage unavailable: status stays "not fully protected" */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Re-renders when any wallet's protection status changes (this tab or another). */
export function useKitVerified(keyIds: string[]): { verified: Set<string>; allVerified: boolean } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  const verified = new Set(keyIds.filter(isKitVerified));
  return { verified, allVerified: keyIds.length > 0 && verified.size === keyIds.length };
}
