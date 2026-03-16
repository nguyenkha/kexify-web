import { useState, useEffect } from "react";
import { authHeaders } from "../lib/auth";
import { sensitiveHeaders, authenticatePasskey } from "../lib/passkey";
import { apiUrl } from "../lib/apiBase";
import { listKeyShares, hasKeyShare } from "../lib/keystore";
import { RecoveryGuide } from "./RecoveryGuide";

interface AccountStatus {
  id: string;
  name: string | null;
  hasClientBackup: boolean;
  hkdfDownloadedAt: string | null;
  selfCustodyAt: string | null;
  hasBrowserShare: boolean;
}

export function RecoveryChecklist() {
  const [accounts, setAccounts] = useState<AccountStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [hkdfDownloadingId, setHkdfDownloadingId] = useState<string | null>(null);
  const [hkdfError, setHkdfError] = useState<string | null>(null);

  function fetchAccounts() {
    const browserShares = listKeyShares();
    const browserIds = new Set(browserShares.map((s) => s.keyId));

    fetch(apiUrl("/api/keys"), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const keys = (d.keys || []) as Array<Record<string, unknown>>;
        setAccounts(keys.filter((k) => k.enabled).map((k) => ({
          id: k.id as string,
          name: k.name as string | null,
          hasClientBackup: !!k.hasClientBackup,
          hkdfDownloadedAt: k.hkdfDownloadedAt as string | null,
          selfCustodyAt: k.selfCustodyAt as string | null,
          hasBrowserShare: browserIds.has(k.id as string) || hasKeyShare(k.id as string),
        })));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchAccounts(); }, []);

  async function handleHkdfDownload(account: AccountStatus) {
    setHkdfDownloadingId(account.id);
    setHkdfError(null);
    try {
      await authenticatePasskey({});
      const headers = sensitiveHeaders();
      const res = await fetch(apiUrl(`/api/keys/${account.id}/backup/server-share-hkdf`), { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setHkdfError(data.error || "Download failed");
        setHkdfDownloadingId(null);
        return;
      }
      const { encryptedShare, encryptedEddsaShare } = await res.json();
      const payload = JSON.stringify({ id: account.id, peer: 2, encryptedShare, encryptedEddsaShare, encryption: "server-hkdf" }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = account.name ? account.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : account.id.slice(0, 8);
      a.download = `kexify-server-hkdf-${safeName}-${account.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      fetchAccounts();
    } catch (err) {
      setHkdfError(String(err));
    }
    setHkdfDownloadingId(null);
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <h2 className="text-lg font-semibold text-text-primary">Backup & Recovery</h2>
        <div className="text-xs text-text-muted text-center py-8">Loading...</div>
      </div>
    );
  }

  const allBrowserShares = accounts.every((a) => a.hasBrowserShare);
  const allBackedUp = accounts.every((a) => a.hasClientBackup);
  const allServerExported = accounts.every((a) => a.hkdfDownloadedAt || a.selfCustodyAt);
  const overallReady = allBrowserShares && allBackedUp && allServerExported;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Backup & Recovery</h2>
        <p className="text-xs text-text-muted mt-1">
          Keep your wallet safe. Complete these steps so you can recover your accounts if needed.
        </p>
      </div>

      {/* Overall status */}
      {overallReady ? (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3">
          <p className="text-xs text-green-400 font-medium">All set! Your wallet is fully backed up.</p>
          <p className="text-[11px] text-green-400/70 mt-1">
            You can recover all your accounts even if you lose access to this device or our server goes down.
          </p>
        </div>
      ) : (
        <div className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg px-4 py-3">
          <p className="text-xs text-yellow-500 font-medium">Some backup steps are incomplete</p>
          <p className="text-[11px] text-yellow-500/70 mt-1">
            Complete the checklist below to ensure you can always recover your wallet.
          </p>
        </div>
      )}

      {/* Per-account checklist */}
      {accounts.map((account) => {
        const serverKeyDone = !!(account.hkdfDownloadedAt || account.selfCustodyAt);

        const steps = [
          {
            key: "browser",
            label: "Key saved in this browser",
            detail: "Your key is encrypted and stored locally so you can sign transactions.",
            action: "Save your key file to this browser during account creation, or import it from a backup file.",
            done: account.hasBrowserShare,
          },
          {
            key: "escrow",
            label: "Key backed up on server",
            detail: "An encrypted copy of your key is stored on our server. You can restore it on any device.",
            action: "During account creation, choose to save an encrypted backup. You can also upload it later.",
            done: account.hasClientBackup,
          },
          {
            key: "server",
            label: "Server key downloaded",
            detail: serverKeyDone
              ? account.selfCustodyAt
                ? "You hold a self-custody copy of the server's key share."
                : "You have a server-encrypted backup. Contact kexify support to decrypt it in an emergency."
              : "Download a backup of the server's key share. It's encrypted by the server — in an emergency, contact us to decrypt it.",
            done: serverKeyDone,
          },
        ];

        const completedCount = steps.filter((s) => s.done).length;
        const allDone = completedCount === steps.length;

        return (
          <div key={account.id}>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-xs font-medium text-text-primary">
                {account.name || `Account ${account.id.slice(0, 8)}`}
              </p>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                allDone ? "bg-green-500/10 text-green-400" : "bg-yellow-500/10 text-yellow-400"
              }`}>
                {completedCount}/{steps.length}
              </span>
            </div>
            <div className="bg-surface-secondary rounded-lg border border-border-primary overflow-hidden divide-y divide-border-secondary">
              {steps.map((step, i) => (
                <div key={i} className="px-3 md:px-5 py-3 flex items-start gap-3">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    step.done ? "bg-green-500/10" : "bg-surface-tertiary"
                  }`}>
                    {step.done ? (
                      <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-text-muted/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium ${step.done ? "text-text-secondary" : "text-text-primary"}`}>
                      {step.label}
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">{step.detail}</p>
                    {!step.done && step.key === "server" && (
                      <div className="mt-2 space-y-1.5">
                        <button
                          onClick={() => handleHkdfDownload(account)}
                          disabled={hkdfDownloadingId === account.id}
                          className="px-3 py-1.5 rounded-md text-[11px] font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                        >
                          {hkdfDownloadingId === account.id ? "Downloading..." : "Download server key backup"}
                        </button>
                        <p className="text-[10px] text-text-muted leading-relaxed">
                          For full self-custody, use Expert mode in Config.
                        </p>
                        {hkdfError && hkdfDownloadingId === null && (
                          <p className="text-[10px] text-red-400">{hkdfError}</p>
                        )}
                      </div>
                    )}
                    {!step.done && step.key !== "server" && (
                      <p className="text-[10px] text-blue-400/80 mt-1 leading-relaxed">{step.action}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <RecoveryGuide />
    </div>
  );
}
