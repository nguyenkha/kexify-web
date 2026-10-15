// Address-book label lookup for history rows and tx detail (UX spec: history.md).

import { getAddressBook } from "./addressBook";

/** Saved label for an address, or null. EVM-style hex addresses compare case-insensitively. */
export function addressLabel(address: string | undefined): string | null {
  if (!address) return null;
  const needle = address.toLowerCase();
  try {
    const hit = getAddressBook().find((e) => e.label && e.address.toLowerCase() === needle);
    return hit?.label ?? null;
  } catch {
    return null;
  }
}
