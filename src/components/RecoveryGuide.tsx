import { useCallback } from "react";

const REPO_URL: string = (import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com/nguyenkha/kexify-web";
const RECOVERY_URL = typeof window !== "undefined" ? `${window.location.origin}/recovery` : "/recovery";

export function RecoveryGuide() {
  const downloadHandbook = useCallback(() => {
    const md = `# kexify Recovery Handbook

## How to Recover

### Step 1: Get both key files
You need two .json files:
- **Your key file** — downloaded during account creation or from Backup & Recovery
- **Server key file** — downloaded from Backup & Recovery > Server Key Share
  - If you used "Safe backup": contact kexify support to get the decryption key first
  - If you used "Self-custody": use the passphrase you chose during export

### Step 2: Open the recovery page
Go to: ${RECOVERY_URL}

The app works entirely in your browser — no server connection needed.
If the app is unavailable, you can self-host it from the source code:
${REPO_URL}

### Step 3: Load your key files
1. Upload "Your key file" (enter passphrase if encrypted)
2. Upload "Server key file" (enter passphrase if encrypted)
3. Click "Enter Recovery Mode"

### Step 4: Move your funds
Once in recovery mode, send your funds to a new wallet.
You can also use WalletConnect to interact with any dApp.

## Alternative: CLI Recovery

If the web app is unavailable, you can recover using the command-line tool:

1. Clone the source code: ${REPO_URL}
2. Follow the CLI recovery instructions in the README
3. The CLI can export your private key for use in any wallet

## Important Links

- Recovery page: ${RECOVERY_URL}
- Source code: ${REPO_URL}

## About Server-Encrypted Backup Files

If you downloaded the server key using the "Safe backup" option, the file is encrypted
by the server using a key derived from your account. You cannot decrypt it on your own.

**In case of emergency** (e.g., the service is shutting down or you need to recover
without server access), contact kexify support or our designated escrow service to
obtain the decryption key for your backup file.

Once you have the decryption key, you can use it together with your client key file
in the recovery page to regain access to your funds.

## Tips

- Store your key files in separate secure locations (USB drive, password manager, etc.)
- Never share your key files with anyone
- The two key files are useless individually — both are needed together
- Test recovery periodically to make sure your files are intact
- The "Safe backup" server key file requires contacting kexify support to decrypt
- The "Self-custody" server key file is encrypted with your passphrase — no support needed

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
          How to recover
        </p>
        <div className="bg-surface-secondary rounded-xl border border-border-primary overflow-hidden divide-y divide-border-secondary">
          <div className="px-3 md:px-5 py-3 flex items-start gap-3">
            <span className="text-sm shrink-0 mt-0.5">1</span>
            <div>
              <p className="text-xs font-medium text-text-primary">Get both key files</p>
              <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                You need your key file and the server key file. Both should be saved as .json files.
              </p>
            </div>
          </div>
          <div className="px-3 md:px-5 py-3 flex items-start gap-3">
            <span className="text-sm shrink-0 mt-0.5">2</span>
            <div>
              <p className="text-xs font-medium text-text-primary">Open the recovery page</p>
              <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                Go to{" "}
                <a href={RECOVERY_URL} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                  {RECOVERY_URL}
                </a>
                {" "}and load both files. The app works offline — no server needed.
              </p>
            </div>
          </div>
          <div className="px-3 md:px-5 py-3 flex items-start gap-3">
            <span className="text-sm shrink-0 mt-0.5">3</span>
            <div>
              <p className="text-xs font-medium text-text-primary">Move your funds</p>
              <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed">
                Once in recovery mode, send your funds to a new wallet for best security.
                You can also use WalletConnect to interact with any dApp.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Important links */}
      <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden divide-y divide-border-secondary">
        <div className="px-3 py-2.5">
          <p className="text-[10px] text-text-muted mb-1">Recovery page</p>
          <p className="text-xs font-mono text-text-secondary break-all">{RECOVERY_URL}</p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[10px] text-text-muted mb-1">Source code (in case app is unavailable)</p>
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
        Download Recovery Handbook
      </button>
    </>
  );
}
