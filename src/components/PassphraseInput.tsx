import { useState } from "react";

interface PassphraseInputProps {
  mode: "set" | "enter";
  onSubmit: (passphrase: string) => Promise<void>;
  error?: string;
  submitLabel?: string;
  hideHint?: boolean;
}

export function PassphraseInput({ mode, onSubmit, error, submitLabel, hideHint }: PassphraseInputProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  const displayError = error || localError;

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!passphrase) return;

    if (mode === "set") {
      if (passphrase.length < 8) {
        setLocalError("Passphrase must be at least 8 characters");
        return;
      }
      if (passphrase !== confirm) {
        setLocalError("Passphrases do not match");
        return;
      }
    }

    setLocalError("");
    setLoading(true);
    try {
      await onSubmit(passphrase);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const label = submitLabel ?? (mode === "set" ? "Encrypt" : "Decrypt");

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {mode === "set" && !hideHint && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-yellow-500">
            You will need this passphrase to sign transactions. There is no way to recover it.
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs text-text-tertiary mb-1.5">
          {mode === "set" ? "Set passphrase" : "Enter passphrase"}
        </label>
        <input
          autoFocus
          type="password"
          value={passphrase}
          onChange={(e) => { setPassphrase(e.target.value); setLocalError(""); }}
          placeholder="Passphrase"
          className="w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {mode === "set" && (
        <div>
          <label className="block text-xs text-text-tertiary mb-1.5">Confirm passphrase</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); setLocalError(""); }}
            placeholder="Confirm passphrase"
            className="w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      )}

      {displayError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <p className="text-xs text-red-400">{displayError}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !passphrase || (mode === "set" && !confirm)}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-tertiary disabled:text-text-muted text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        {loading && (
          <div className="w-4 h-4 relative">
            <div className="absolute inset-0 rounded-full border-2 border-white/20" />
            <div className="absolute inset-0 rounded-full border-2 border-white border-t-transparent animate-spin" />
          </div>
        )}
        {loading ? "Processing..." : label}
      </button>
    </form>
  );
}
