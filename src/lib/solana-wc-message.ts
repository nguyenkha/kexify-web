import { base58 } from "@scure/base";

/** WalletConnect Solana spec: `params.message` is base58-encoded bytes. */
export function decodeSolanaMessageParam(message: string): Uint8Array {
  return base58.decode(message);
}

/** WalletConnect Solana spec: the response signature is base58. */
export function encodeSolanaSignature(sig: Uint8Array): string {
  return base58.encode(sig);
}
