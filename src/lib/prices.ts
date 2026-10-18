// Fetch USD prices from CoinGecko free API
import { displayAmount } from "./display-amount";
import { getCache, setCache, getCacheTtl, PRICES_CACHE_KEY } from "./dataCache";

// Map asset symbols to CoinGecko IDs
const COINGECKO_IDS: Record<string, string> = {
  ETH: "ethereum",
  BTC: "bitcoin",
  USDT: "tether",
  USDC: "usd-coin",
  DAI: "dai",
  WBTC: "wrapped-bitcoin",
  WETH: "weth",
  USDe: "ethena-usde",
  XRP: "ripple",
  XLM: "stellar",
  SOL: "solana",
  BCH: "bitcoin-cash",
  TON: "the-open-network",
  TRX: "tron",
  LTC: "litecoin",
  DOGE: "dogecoin",
  ALGO: "algorand",
  ADA: "cardano",
};

// In-memory fallback (survives within same session even if localStorage fails)
let memoryCache: Record<string, number> = {};
let lastFetch = 0;

export async function fetchPrices(): Promise<Record<string, number>> {
  const now = Date.now();

  // Check in-memory cache first (fastest)
  if (now - lastFetch < getCacheTtl() && Object.keys(memoryCache).length > 0) {
    return memoryCache;
  }

  // Check localStorage cache (survives navigation)
  const cached = getCache<Record<string, number>>(PRICES_CACHE_KEY);
  if (cached && Object.keys(cached).length > 0) {
    memoryCache = cached;
    lastFetch = now;
    return cached;
  }

  const ids = Object.values(COINGECKO_IDS).join(",");
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
    );
    if (!res.ok) return memoryCache;
    const data = await res.json();

    const prices: Record<string, number> = {};
    for (const [symbol, cgId] of Object.entries(COINGECKO_IDS)) {
      if (data[cgId]?.usd) {
        prices[symbol] = data[cgId].usd;
      }
    }
    memoryCache = prices;
    lastFetch = now;
    setCache(PRICES_CACHE_KEY, prices);
    return prices;
  } catch {
    return memoryCache;
  }
}

/** "$1,234.56" with the UI language's separators ("$1.234,56" in Spanish); "< $0.01" for dust. */
export function formatUsd(amount: number): string {
  if (amount === 0) return "$" + displayAmount("0.00");
  if (amount < 0.01) return `< $${displayAmount("0.01")}`;
  return "$" + displayAmount(amount.toFixed(2));
}

export function getUsdValue(
  balance: string,
  symbol: string,
  prices: Record<string, number>
): number | null {
  const price = prices[symbol];
  if (price == null) return null;
  const num = parseFloat(balance);
  if (isNaN(num) || num === 0) return null;
  return num * price;
}
