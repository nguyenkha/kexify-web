// Shared handling of "this login is over" answers (401 session_revoked / session_required): sign out to the
// login page. A screen that already explains why (the "account locked" screen after a decline) holds it off
// so its message is not replaced; the user signs in from there.
import { signOut } from "./auth";

let held = false;

/** While held, a session-ended answer does not redirect (the current screen handles sign-in). */
export function holdSessionEndRedirect(on: boolean): void {
  held = on;
}

/** Signs out when the answer means the session ended. Returns true when it did (or would have, while held). */
export function handleSessionEnded(status: number, code: unknown): boolean {
  if (status !== 401 || (code !== "session_revoked" && code !== "session_required")) return false;
  if (!held) signOut({ sessionEnded: true });
  return true;
}
