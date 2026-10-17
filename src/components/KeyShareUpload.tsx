import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PassphraseInput } from "./PassphraseInput";
import { decryptKeyFile, isEncryptedKeyFile, type KeyFileData } from "../lib/crypto";

/**
 * Key share file for an account whose share is not on this device (file-only storage).
 * A device that holds the share never shows this: the sign tap unlocks it.
 */
export function KeyShareUpload({ keyFile, onChange, expectedKeyId, showRestoreHint }: {
  keyFile: KeyFileData | null;
  onChange: (kf: KeyFileData | null) => void;
  /** The key that owns the account: a file of another key is refused (it would sign from that key). */
  expectedKeyId?: string;
  showRestoreHint?: boolean;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingEncrypted, setPendingEncrypted] = useState<KeyFileData | null>(null);
  const [error, setError] = useState("");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file.text().then((text) => {
      try {
        const data = JSON.parse(text) as KeyFileData;
        if (!data.id || !data.share || !data.publicKey) return;
        if (expectedKeyId && data.id !== expectedKeyId) { setError(t("signKey.wrongKeyFile")); return; }
        setError("");
        if (isEncryptedKeyFile(data)) { setPendingEncrypted(data); onChange(null); }
        else { setPendingEncrypted(null); onChange(data); }
      } catch {
        // not a key file
      }
    });
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs text-text-muted mb-1.5">{t("signKey.label")}</label>
      <input ref={inputRef} type="file" accept=".json" onChange={handleFile} className="hidden" />
      {keyFile ? (
        <div className="bg-surface-primary border border-border-primary rounded-lg px-3 py-2.5 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p className="flex-1 min-w-0 text-xs text-text-secondary truncate">{t("signKey.fileLoaded")}</p>
          <button
            onClick={() => onChange(null)}
            className="text-[11px] text-text-muted hover:text-text-tertiary transition-colors"
          >
            {t("signKey.removeFile")}
          </button>
        </div>
      ) : pendingEncrypted ? (
        <div className="bg-surface-primary border border-border-primary rounded-lg p-3">
          <p className="text-xs text-text-muted mb-2">{t("signKey.filePassphrase")}</p>
          <PassphraseInput
            mode="enter"
            submitLabel={t("common.decrypt")}
            onSubmit={async (passphrase) => {
              onChange(await decryptKeyFile(pendingEncrypted, passphrase));
              setPendingEncrypted(null);
            }}
          />
        </div>
      ) : (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            className="w-full bg-surface-primary border border-border-primary border-dashed rounded-lg px-3 py-3 flex items-center justify-center gap-2 hover:border-blue-500/50 transition-colors"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <span className="text-xs text-text-muted">{t("signKey.upload")}</span>
          </button>
          {error && <p className="text-[11px] text-red-400 text-center">{error}</p>}
          {showRestoreHint && <p className="text-[10px] text-text-muted text-center">{t("signKey.restoreFromBackup")}</p>}
        </>
      )}
    </div>
  );
}
