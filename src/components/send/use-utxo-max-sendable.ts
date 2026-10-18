// BTC / LTC / BCH / DOGE "Max": what one tx of the wallet's largest coins can send, at most the input cap
// (MAX_TX_INPUTS; none in recovery mode), fee for that many inputs included. The UTXO list is fetched once
// per dialog; null until it and the fee rate are known (Max falls back to balance - fee, as before).
import { useEffect, useState } from "react";
import type { Chain, Asset } from "../../lib/api";
import * as btc from "../../lib/chains/btcTx";
import * as ltc from "../../lib/chains/ltcTx";
import * as bch from "../../lib/chains/bchTx";
import * as doge from "../../lib/chains/dogeTx";
import { utxosWithProxyFallback } from "../../lib/chains/chain-proxy-utxo";
import { utxoInputCap } from "./build-with-utxo-input-cap";

export interface UtxoMaxSendable {
  sats: bigint;
  /** The wallet has more coins than one tx can spend: Max leaves the smallest ones behind. */
  capped: boolean;
  maxInputs: number;
}

const UTXO_CHAINS = ["btc", "ltc", "bch", "doge"];

export function useUtxoMaxSendable(
  chain: Chain, asset: Asset, address: string, feeRate: number | null, to: string, manualUtxos: btc.UTXO[] | null,
): UtxoMaxSendable | null {
  const active = UTXO_CHAINS.includes(chain.type) && asset.isNative;
  const [utxos, setUtxos] = useState<btc.UTXO[] | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = utxosWithProxyFallback({ name: chain.name }, address, () => (chain.type === "btc" ? btc.fetchUtxos(address, btc.mempoolApiUrl(chain.explorerUrl))
      : chain.type === "ltc" ? ltc.fetchUtxos(address, ltc.ltcApiUrl(chain.explorerUrl))
        : chain.type === "doge" ? doge.fetchUtxos(address)
          : bch.fetchUtxos(address, bch.bchApiUrl())));
    load.then((u) => { if (live) setUtxos(u); }).catch(() => {});
    return () => { live = false; };
  }, [active, chain.name, chain.type, chain.explorerUrl, address]);

  const pool = manualUtxos ?? utxos;
  if (!active || !pool || feeRate == null) return null;
  const cap = utxoInputCap();
  const r = chain.type === "btc" ? btc.maxSendableSats(pool, feeRate, btc.detectAddressType(address), cap, to || undefined)
    : chain.type === "ltc" ? ltc.maxSendableSats(pool, feeRate, ltc.detectAddressType(address), cap, to || undefined)
      : chain.type === "doge" ? doge.maxSendableSats(pool, feeRate, cap, to || undefined)
        : bch.maxSendableSats(pool, feeRate, cap);
  return { sats: r.sats, capped: r.capped, maxInputs: cap };
}
