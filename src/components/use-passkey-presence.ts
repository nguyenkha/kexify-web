import { useCallback, useState } from "react";
import { fetchPasskeys } from "../lib/passkey";
import { isRecoveryMode } from "../lib/recovery";

/**
 * Whether the user has a passkey, fetched when the dialog opens (not on the Confirm click), so
 * the click reaches the signing passkey without a network wait and keeps its user activation.
 * A failed check reads as "has one" (the server still enforces). markRegistered after the gate.
 */
function lookUp(): Promise<boolean> {
  return fetchPasskeys().then((list) => list.length > 0, () => true);
}

export function usePasskeyPresence(): { hasPasskey: () => Promise<boolean>; markRegistered: () => void } {
  const [check, setCheck] = useState<Promise<boolean>>(() => isRecoveryMode() ? Promise.resolve(true) : lookUp());
  const markRegistered = useCallback(() => setCheck(Promise.resolve(true)), []);
  // "None" is checked again at the click (a failed or stale first look must not gate the whole dialog).
  return { hasPasskey: async () => (await check) || lookUp(), markRegistered };
}
