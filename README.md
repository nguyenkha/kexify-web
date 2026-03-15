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

## License

MIT
