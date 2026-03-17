import { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { apiUrl } from "../lib/apiBase";

export function FreezeAccount() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");
  const [status, setStatus] = useState<"confirm" | "loading" | "success" | "error">(
    token ? "confirm" : "error"
  );
  const [error, setError] = useState(token ? "" : "No freeze token provided");

  async function handleFreeze() {
    setStatus("loading");
    try {
      const res = await fetch(apiUrl(`/api/auth/freeze?token=${encodeURIComponent(token!)}`));
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to freeze account");
      }
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setError((err as { message?: string })?.message || "Failed to freeze account");
    }
  }

  return (
    <div className="min-h-dvh bg-surface-primary flex items-center justify-center p-4">
      <div className="max-w-sm w-full text-center">
        {status === "confirm" && (
          <>
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-text-primary mb-1">kexify</h1>
            <p className="text-[11px] text-text-muted mb-6">keys simplified</p>
            <p className="text-sm text-text-secondary mb-2">
              Freeze your account?
            </p>
            <p className="text-xs text-text-muted mb-6 leading-relaxed">
              This will immediately block all signing, key generation, and account changes.
              Unfreezing requires passkey verification and a 24-hour cooling period.
            </p>
            <button
              onClick={handleFreeze}
              className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              🥶 Freeze My Account
            </button>
            <button
              onClick={() => navigate("/login")}
              className="w-full mt-3 bg-surface-tertiary text-text-secondary hover:bg-border-primary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </>
        )}

        {status === "loading" && (
          <>
            <div className="relative w-16 h-16 mx-auto mb-4">
              <svg className="w-16 h-16 animate-spin" viewBox="0 0 50 50" fill="none">
                <circle cx="25" cy="25" r="20" stroke="currentColor" strokeWidth="3" className="text-surface-tertiary" />
                <path d="M25 5 A20 20 0 0 1 45 25" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-blue-500" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-secondary">Freezing your account…</p>
            <p className="text-xs text-text-muted mt-1">This may take a few seconds.</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-text-primary mb-1">Account frozen</p>
            <p className="text-xs text-text-muted mb-6">
              All signing, key generation, and account changes have been blocked.
              You can unfreeze from your account settings (requires passkey + 24h cooling period).
            </p>
            <button
              onClick={() => navigate("/accounts")}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Go to dashboard
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text-primary mb-1">Couldn't freeze account</p>
            <p className="text-xs text-red-400 break-all mb-5">{error}</p>
            <button
              onClick={() => navigate("/login")}
              className="bg-surface-tertiary text-text-secondary hover:bg-border-primary px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Go to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
