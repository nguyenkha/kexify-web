import type { ChainType, ChainAdapter } from "../../shared/types";
import { evmAdapter } from "./evmAdapter";
import { btcAdapter } from "./btcAdapter";
import { solanaAdapter } from "./solanaAdapter";
import { xrpAdapter } from "./xrpAdapter";
import { bchAdapter } from "./bchAdapter";
import { ltcAdapter } from "./ltcAdapter";
import { xlmAdapter } from "./xlmAdapter";

const adapters: Record<ChainType, ChainAdapter> = {
  evm: evmAdapter,
  btc: btcAdapter,
  bch: bchAdapter,
  ltc: ltcAdapter,
  solana: solanaAdapter,
  xrp: xrpAdapter,
  xlm: xlmAdapter,
};

export function getChainAdapter(type: ChainType): ChainAdapter {
  return adapters[type];
}
