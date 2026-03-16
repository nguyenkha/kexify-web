import { useState, useEffect } from "react";
import { useWalletConnect } from "../context/WalletConnectContext";
import { Scanner } from "@yudiel/react-qr-scanner";
import type { KeyShare } from "../shared/types";
import { authHeaders } from "../lib/auth";
import { apiUrl } from "../lib/apiBase";
import { getChainAdapter } from "../lib/chains/adapter";
import { useFrozen } from "../context/FrozenContext";

export function WalletConnect() {
  const frozen = useFrozen();
  const { initialized, sessions, pair, disconnect } = useWalletConnect();
  const [uri, setUri] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [addressNames, setAddressNames] = useState<Record<string, string>>({});

  // Build address → account name map from keys
  useEffect(() => {
    if (!initialized || sessions.length === 0) return;
    fetch(apiUrl("/api/keys"), { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const keys = (d.keys || []) as KeyShare[];
        const map: Record<string, string> = {};
        const evmAdapter = getChainAdapter("evm");
        const solanaAdapter = getChainAdapter("solana");
        for (const key of keys) {
          const name = key.name || `Key ${key.id.slice(0, 8)}`;
          if (key.publicKey) {
            map[evmAdapter.deriveAddress(key.publicKey).toLowerCase()] = name;
          }
          if (key.eddsaPublicKey) {
            map[solanaAdapter.deriveAddress(key.eddsaPublicKey)] = name;
          }
        }
        setAddressNames(map);
      });
  }, [initialized, sessions.length]);

  async function handlePair() {
    if (!uri.trim()) return;
    setPairing(true);
    setError("");
    try {
      await pair(uri.trim());
      setUri("");
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setPairing(false);
    }
  }

  function startScanning() {
    setScanning(true);
    setError("");
  }

  function stopScanning() {
    setScanning(false);
  }

  async function handleScan(result: { rawValue: string }[]) {
    if (!result?.[0]?.rawValue) return;
    const text = result[0].rawValue;
    setScanning(false);
    if (text.startsWith("wc:")) {
      setPairing(true);
      try {
        await pair(text);
      } catch (err: any) {
        setError(err.message || String(err));
      } finally {
        setPairing(false);
      }
    } else {
      setError("Invalid QR code — expected a WalletConnect URI");
    }
  }

  if (!initialized) {
    return (
      <div className="w-full">
        <h2 className="text-lg font-semibold text-text-primary mb-2">WalletConnect</h2>
        <p className="text-xs text-text-muted leading-relaxed">
          WalletConnect is not configured. Set <code className="text-text-tertiary">VITE_WC_PROJECT_ID</code> environment variable.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h2 className="text-lg font-semibold text-text-primary">WalletConnect</h2>
      <p className="text-xs text-text-muted mt-2 leading-relaxed">
        Connect your accounts to dApps. Signing requests will appear here for your approval.
      </p>

      {/* Connect — inline row on desktop, stacked on mobile */}
      <div className="mt-5 flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePair()}
          placeholder="Paste wc: URI"
          className="flex-1 bg-surface-secondary border border-border-primary rounded-lg px-3 py-2.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/50 font-mono"
          disabled={pairing}
        />
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handlePair}
            disabled={pairing || !uri.trim() || frozen}
            className="flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40"
          >
            {pairing ? "Connecting..." : "🔗 Connect"}
          </button>
          {!scanning ? (
            <button
              onClick={startScanning}
              disabled={pairing || frozen}
              className="px-3 py-2.5 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-surface-tertiary border border-border-primary transition-colors disabled:opacity-40"
              title="Scan QR code"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9V5a2 2 0 012-2h4M15 3h4a2 2 0 012 2v4M21 15v4a2 2 0 01-2 2h-4M9 21H5a2 2 0 01-2-2v-4" />
              </svg>
            </button>
          ) : (
            <button
              onClick={stopScanning}
              className="px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-500/10 border border-border-primary transition-colors"
              title="Stop scanning"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* QR scanner */}
      {scanning && (
        <div className="mt-3 rounded-lg overflow-hidden border border-border-primary" style={{ maxWidth: 400 }}>
          <Scanner
            onScan={handleScan}
            onError={() => {
              setScanning(false);
              setError("Camera access denied");
            }}
            formats={["qr_code"]}
            components={{ finder: true }}
            styles={{ container: { width: "100%" } }}
          />
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}

      {/* Sessions */}
      <div className="mt-8">
        {sessions.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-surface-tertiary flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.354a4.5 4.5 0 00-6.364-6.364L4.5 8.25a4.5 4.5 0 006.364 6.364l4.5-4.5z" />
              </svg>
            </div>
            <p className="text-xs text-text-muted">No active sessions</p>
            <p className="text-[11px] text-text-muted/60 mt-1">Paste a WalletConnect URI from a dApp to connect.</p>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-text-muted uppercase tracking-wider mb-3">
              Active Sessions
            </p>
            <div className="space-y-px bg-surface-secondary border border-border-primary rounded-lg overflow-hidden">
              {sessions.map((session) => {
                const { peer } = session;
                const accounts = Object.values(session.namespaces)
                  .flatMap((ns) => ns.accounts);
                // Deduplicate by address (strip namespace:chainId prefix)
                const seen = new Set<string>();
                const uniqueAccounts: { address: string; name: string | null }[] = [];
                for (const a of accounts) {
                  const parts = a.split(":");
                  const addr = parts.slice(2).join(":");
                  if (!addr || seen.has(addr.toLowerCase())) continue;
                  seen.add(addr.toLowerCase());
                  const name = addressNames[addr.toLowerCase()] || addressNames[addr] || null;
                  uniqueAccounts.push({ address: addr, name });
                }

                return (
                  <div
                    key={session.topic}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-tertiary/40 transition-colors"
                  >
                    {peer.metadata.icons?.[0] ? (
                      <img
                        src={peer.metadata.icons[0]}
                        alt={peer.metadata.name}
                        className="w-8 h-8 rounded-lg bg-surface-tertiary shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-surface-tertiary flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-text-muted">
                          {peer.metadata.name?.charAt(0)?.toUpperCase() || "?"}
                        </span>
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate leading-tight">{peer.metadata.name}</p>
                      <p className="text-[11px] text-text-muted truncate">{peer.metadata.url}</p>
                      {uniqueAccounts.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                          {uniqueAccounts.map(({ address, name }) => (
                            <span key={address} className="text-[10px] text-text-muted/60">
                              {name ? (
                                <><span className="text-text-tertiary">{name}</span>{" "}<span className="font-mono">{address.slice(0, 6)}...{address.slice(-4)}</span></>
                              ) : (
                                <span className="font-mono">{address.slice(0, 6)}...{address.slice(-4)}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => disconnect(session.topic)}
                      className="p-1.5 rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      title="Disconnect"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
