import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LockOpen } from "lucide-react";
import { getKeyShareWithPassphrase, getKeyShareWithPrf, listKeyShares, type KeyShareInfo } from "../lib/keystore";
import { localPrfAuthenticate } from "../lib/passkey";
import { unfreezeWithSharePossession } from "../lib/unfreeze-share-proof";
import type { KeyFileData } from "../lib/crypto";
import { Button, ErrorBox } from "./ui";

/**
 * Unfreeze for an account with no active passkey: prove this browser holds one of the
 * account's wallets (its client share). The unfreeze still waits out the cooling period.
 */
export function UnfreezeWithWalletDialog({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const shares = listKeyShares().filter((s) => s.type === "email");
  const [selected, setSelected] = useState<KeyShareInfo | null>(shares.length === 1 ? shares[0] : null);
  const [passphrase, setPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function prove(load: () => Promise<KeyFileData | null>) {
    setLoading(true);
    setError("");
    try {
      // A wrong passphrase or a cancelled passkey prompt is an unlock failure, not a proof failure.
      const keyData = await load().catch(() => null);
      if (!keyData) throw new Error("unlock");
      await unfreezeWithSharePossession(keyData);
      onDone();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      const known: Record<string, string> = {
        unlock: "freeze.walletProof.unlockFailed",
        HAS_PASSKEY: "freeze.walletProof.hasPasskey",
        PASSPHRASE_ESCROW: "freeze.walletProof.escrowed",
        CREATED_AFTER_FREEZE: "freeze.walletProof.createdAfterFreeze",
        NOT_YOUR_WALLET: "freeze.walletProof.notYourWallet",
        UNKNOWN_ORIGIN: "freeze.walletProof.unknownOrigin",
        ALREADY_SCHEDULED: "freeze.walletProof.alreadyScheduled",
        CHALLENGE_EXPIRED: "freeze.walletProof.expired",
      };
      setError(t(known[code] ?? "freeze.walletProof.failed"));
      setLoading(false);
    }
  }

  const unlockWithPasskey = (s: KeyShareInfo) => prove(async () => getKeyShareWithPrf(s.keyId, await localPrfAuthenticate(s.credentialId!)));
  const unlockWithPassphrase = (s: KeyShareInfo) => prove(() => getKeyShareWithPassphrase(s.keyId, passphrase));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={loading ? undefined : onCancel} />
      <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-md shadow-xl px-5 py-5 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <LockOpen className="w-4 h-4" />{t("freeze.walletProof.title")}
        </h3>
        <p className="text-sm text-text-secondary">{t("freeze.walletProof.desc")}</p>

        {shares.length === 0 && <ErrorBox>{t("freeze.walletProof.noWallet")}</ErrorBox>}

        {shares.length > 1 && (
          <div className="space-y-1">
            {shares.map((s) => (
              <button
                key={s.keyId}
                onClick={() => setSelected(s)}
                className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${selected?.keyId === s.keyId ? "border-blue-500" : "border-border-primary"}`}
              >
                {s.name || s.keyId.slice(0, 8)}
              </button>
            ))}
          </div>
        )}

        {selected && (selected.mode === "prf" && selected.credentialId ? (
          <Button fullWidth onClick={() => unlockWithPasskey(selected)} disabled={loading}>
            {loading ? t("freeze.walletProof.working") : t("freeze.walletProof.unlockPasskey")}
          </Button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); unlockWithPassphrase(selected); }} className="space-y-2">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t("freeze.walletProof.passphrase")}
              className="w-full px-3 py-2 rounded-lg bg-surface-primary border border-border-primary text-sm"
              autoFocus
            />
            <Button fullWidth type="submit" disabled={loading || !passphrase}>
              {loading ? t("freeze.walletProof.working") : t("freeze.walletProof.unlockPassphrase")}
            </Button>
          </form>
        ))}

        {error && <ErrorBox>{error}</ErrorBox>}
        <Button variant="secondary" fullWidth onClick={onCancel} disabled={loading}>{t("freeze.cancel")}</Button>
      </div>
    </div>
  );
}
