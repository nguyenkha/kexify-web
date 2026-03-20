import { useCallback } from "react";
import { useTranslation } from "react-i18next";

const REPO_URL: string = (import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com/nguyenkha/kexify-web";
const RECOVERY_URL = typeof window !== "undefined" ? `${window.location.origin}/recovery` : "/recovery";

export function RecoveryGuide() {
  const { t } = useTranslation();
  const downloadHandbook = useCallback(() => {
    const md = `# kexify Recovery Handbook

## How to Recover

### Step 1: Get both key files
You need two .json files:
- **Your key file** — downloaded during account creation or from Backup & Recovery
- **Server key file** — downloaded from Backup & Recovery > Server Key Share

There are two types of server key files:
- **Safe backup** (filename: kexify-server-hkdf-*.json) — encrypted by the server.
  Contact kexify support to get the decryption key (a 64-character hex string).
- **Self-custody** (filename: kexify-server-*.json) — encrypted with your passphrase.
  You can decrypt it yourself.

### Step 2: Open the recovery page
Go to: ${RECOVERY_URL}

The app works entirely in your browser — no server connection needed.
If the app is unavailable, you can self-host it from the source code:
${REPO_URL}

### Step 3: Load your key files
1. Upload "Your key file" (enter passphrase if encrypted)
2. Upload "Server key file":
   - For safe backup files: enter the HKDF decryption key (hex) from support
   - For self-custody files: enter the passphrase you chose during export
3. Click "Enter Recovery Mode"

### Step 4: Move your funds
Once in recovery mode, send your funds to a new wallet.
You can also use WalletConnect to interact with any dApp.

## Alternative: CLI Recovery

If the web app is unavailable, you can recover using the command-line tool:

1. Clone the source code: ${REPO_URL}
2. Run: bun frontend/cli.ts recover <your-key.json> <server-key.json>
3. The CLI supports both passphrase-encrypted and HKDF-encrypted files
4. For HKDF files, you will be prompted for the hex decryption key
5. The CLI can also export your private key for use in any wallet

## About Server-Encrypted Backup Files (Safe Backup)

If you downloaded the server key using the "Safe backup" option, the file is encrypted
by the server using a key derived from your account (HKDF). You cannot decrypt it alone.

**In case of emergency** (e.g., the service is shutting down or you need to recover
without server access), contact kexify support or our designated escrow service to
obtain the 64-character hex decryption key for your backup file.

Both the recovery page and the CLI tool accept this hex key to decrypt the file.

## Important Links

- Recovery page: ${RECOVERY_URL}
- Source code: ${REPO_URL}

## Tips

- Store your key files in separate secure locations (USB drive, password manager, etc.)
- Never share your key files or decryption keys with anyone
- The two key files are useless individually — both are needed together
- Test recovery periodically to make sure your files are intact
- Safe backup files need a hex key from support; self-custody files use your passphrase

---
Generated on ${new Date().toLocaleDateString()} by kexify
`;

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kexify-recovery-handbook.md";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <>
      {/* How to recover */}
      <div>
        <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-2 px-1">
          {t("recovery.howToRecover")}
        </p>
        <div className="bg-surface-secondary rounded-xl border border-border-primary overflow-hidden divide-y divide-border-secondary">
          <div className="px-3 md:px-5 py-3 flex items-start gap-3">
            <span className="text-sm shrink-0 mt-0.5">1</span>
            <div>
              <p className="text-xs font-medium text-text-primary">{t("recovery.getBothKeyFiles")}</p>
              <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                {t("recovery.getBothKeyFilesDesc")}
              </p>
            </div>
          </div>
          <div className="px-3 md:px-5 py-3 flex items-start gap-3">
            <span className="text-sm shrink-0 mt-0.5">2</span>
            <div>
              <p className="text-xs font-medium text-text-primary">{t("recovery.openRecoveryPage")}</p>
              <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                {t("recovery.openRecoveryPageDesc", { url: RECOVERY_URL })}
              </p>
            </div>
          </div>
          <div className="px-3 md:px-5 py-3 flex items-start gap-3">
            <span className="text-sm shrink-0 mt-0.5">3</span>
            <div>
              <p className="text-xs font-medium text-text-primary">{t("recovery.moveFunds")}</p>
              <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                {t("recovery.moveFundsDesc")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Important links */}
      <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden divide-y divide-border-secondary">
        <div className="px-3 py-2.5">
          <p className="text-[10px] text-text-muted mb-1">{t("recovery.recoveryPage")}</p>
          <p className="text-xs font-mono text-text-secondary break-all">{RECOVERY_URL}</p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[10px] text-text-muted mb-1">{t("recovery.sourceCodeDesc")}</p>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-blue-400 hover:text-blue-300 break-all">
            {REPO_URL}
          </a>
        </div>
      </div>

      {/* Download handbook */}
      <button
        onClick={downloadHandbook}
        className="w-full bg-surface-tertiary hover:bg-border-primary text-text-secondary text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        {t("recovery.downloadHandbook")}
      </button>
    </>
  );
}
