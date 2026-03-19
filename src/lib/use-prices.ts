import { useState, useEffect } from "react";
import { fetchPrices } from "./prices";

const DEFAULT_POLL_INTERVAL = 60_000;

/** Single price polling hook — use at parent level, pass result to children. */
export function usePrices(pollInterval = DEFAULT_POLL_INTERVAL) {
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchPrices().then(setPrices);
    const iv = setInterval(() => fetchPrices().then(setPrices), pollInterval);
    return () => clearInterval(iv);
  }, [pollInterval]);

  return prices;
}
