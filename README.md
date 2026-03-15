# kexify

A self-custodial crypto wallet secured by multi-party computation (MPC). Your private key is never stored in one place — it is split between your device and the server using threshold cryptography, so neither side alone can sign transactions.

## Features

- **MPC key generation & signing** — 2-of-2 threshold ECDSA/EdDSA, powered by [cb-mpc](https://github.com/coinbase/cb-mpc)
- **Multi-chain** — Ethereum/EVM, Bitcoin, Bitcoin Cash, Solana, XRP
- **WalletConnect** — connect to any dapp via WalletConnect v2
- **Passkey authentication** — sign in and protect key shares with WebAuthn passkeys
- **Policy rules** — per-key spending limits and approval rules
- **Account freeze** — emergency freeze via email link
- **Recovery mode** — reconstruct keys from two key shares without the server

## Development

```bash
bun install
bun run dev
```

The dev server runs at `http://localhost:5173` and proxies `/api/*` to the backend at `http://localhost:3000`.

## Production build

```bash
bun run build
```

Set `VITE_API_URL` in `.env.production` to point to your backend (e.g. `https://api.kexify.co`). If unset, requests use relative paths (same-origin).

## Environment variables

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend origin for production (e.g. `https://api.kexify.co`) |
| `VITE_WC_PROJECT_ID` | WalletConnect project ID from [cloud.walletconnect.com](https://cloud.walletconnect.com) |

---

## CLI (`cli.ts`)

A Node.js CLI tool for recovery and WalletConnect signing directly from the terminal — no browser, no server required. Useful for emergency access when the server is unavailable.

### Requirements

```bash
bun install
# or
npm install
```

### Usage

```
npx tsx cli.ts <command> <file1> <file2>
```

You need **two key share files** — one from your device and one from the server backup. The peer order is auto-detected from the file contents.

---

### `recover` — Reconstruct private keys and export

Combines the two MPC key shares locally and derives all addresses and private keys. **Nothing is sent to any server.**

```bash
npx tsx cli.ts recover ./peer0.json ./peer2.json
```

You will be prompted for the passphrase(s) used to encrypt the key share files (each file can have a different passphrase).

**Output:**

```
Recovered addresses:
  Ethereum: 0xAbc...
  Bitcoin:  bc1q...
  Solana:   7xKq...
  XRP:      rXyz...

Options:
  1. Export ECDSA private key (hex) — EVM / BTC / XRP
  2. Export EdDSA private key (hex) — Solana
  3. Export private key (WIF) — Bitcoin
  4. Exit
```

> ⚠ Private keys give full access to your funds. Store them offline and never share them.

---

### `connect` — WalletConnect signing from terminal

Connects to a dApp using a WalletConnect URI and handles all signing requests interactively in the terminal using local MPC — the server is never contacted.

```bash
WC_PROJECT_ID=your_project_id npx tsx cli.ts connect ./peer0.json ./peer2.json
```

You will be prompted for the passphrase(s), then paste the `wc:...` URI from the dApp.

**Supported methods:**

| Chain | Methods |
|---|---|
| EVM | `personal_sign`, `eth_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` |
| Solana | `solana_signTransaction`, `solana_signAndSendTransaction`, `solana_signMessage` |

**Environment variables:**

| Variable | Description |
|---|---|
| `WC_PROJECT_ID` | WalletConnect project ID (required for `connect`) |
| `ETH_RPC_URL` | Override EVM RPC endpoint |
| `SOLANA_RPC_URL` | Override Solana RPC endpoint |

## License

MIT — Copyright (c) 2025 Kha Do
