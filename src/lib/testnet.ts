// Test networks (Sepolia, devnet, Cardano PreProd …): one rule for hiding them, badging them and keeping their coins
// out of fiat values and the portfolio total (test coins have no value).

/** Chain names from the API / config.json (`ETHEREUM_SEPOLIA`, `SOLANA_DEVNET`, `CARDANO_PREPROD` …). */
export function isTestnetChain(name: string): boolean {
  return /testnet|sepolia|devnet|preprod/i.test(name);
}

/** Badge text for a test network: Solana's devnet keeps its own name, every other one is "testnet". */
export function testnetLabel(name: string): "devnet" | "testnet" | null {
  if (!isTestnetChain(name)) return null;
  return /devnet/i.test(name) ? "devnet" : "testnet";
}
