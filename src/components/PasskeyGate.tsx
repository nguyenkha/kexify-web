import { useState, useEffect } from "react";
import { registerPasskey, authenticatePasskey } from "../lib/passkey";

/**
 * Blocking dialog shown when a user with zero passkeys attempts a sensitive operation.
 * Forces registration of at least one passkey before proceeding.
 */
export function PasskeyGate({
  onRegistered,
  onCancel,
}: {
  onRegistered: () => void;
  onCancel: () => void;
}) {
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");

  async function handleRegister() {
    setRegistering(true);
    setError("");
    try {
      await registerPasskey();
      // After registration, authenticate immediately to get a token
      await authenticatePasskey({ withPrf: true });
      onRegistered();
    } catch (err) {
      setError(String(err));
      setRegistering(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !registering) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [registering, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={!registering ? onCancel : undefined} />
      <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary">🔑 Passkey Required</h3>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <div className="text-center py-4">
            {/* Shield icon */}
            <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 01-3.6 9.75m6.633-4.596a18.666 18.666 0 01-2.485 5.33" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-primary mb-2">
              Set up a passkey to continue
            </p>
            <p className="text-xs text-text-muted leading-relaxed mb-6 max-w-[280px] mx-auto">
              To protect your account, register a passkey before performing sensitive operations like signing or generating keys.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={onCancel}
                disabled={registering}
                className="px-4 py-2.5 rounded-lg text-xs font-medium bg-surface-tertiary text-text-secondary hover:bg-border-primary transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleRegister}
                disabled={registering}
                className="px-5 py-2.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-60"
              >
                {registering ? "Registering..." : "Add Passkey"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
