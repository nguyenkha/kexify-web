/** Remembers that the user closed the "kexify has moved" notice. Bump the version for a new notice. */
export const MIGRATE_NOTICE_KEY = "kexify.migrateNotice.dismissed.v1";

export function isMigrateNoticeDismissed(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(MIGRATE_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissMigrateNotice(storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
  try {
    storage?.setItem(MIGRATE_NOTICE_KEY, "1");
  } catch {
    // Storage unavailable: the notice simply shows again next visit.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
