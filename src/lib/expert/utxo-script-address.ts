// scriptPubKey → address for the UTXO networks the wallet knows (BTC, LTC, DOGE, mainnet + testnet).
// Read-only display helper for the Expert decoder; unknown scripts return null (shown as raw script).

import { bech32, bech32m, base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha256";

export type UtxoNetwork = "btc" | "btc-testnet" | "ltc" | "ltc-testnet" | "doge" | "doge-testnet";

interface NetworkParams {
  symbol: string;
  hrp: string | null;
  p2pkh: number;
  p2sh: number;
}

export const UTXO_NETWORKS: Record<UtxoNetwork, NetworkParams> = {
  btc: { symbol: "BTC", hrp: "bc", p2pkh: 0x00, p2sh: 0x05 },
  "btc-testnet": { symbol: "tBTC", hrp: "tb", p2pkh: 0x6f, p2sh: 0xc4 },
  ltc: { symbol: "LTC", hrp: "ltc", p2pkh: 0x30, p2sh: 0x32 },
  "ltc-testnet": { symbol: "tLTC", hrp: "tltc", p2pkh: 0x6f, p2sh: 0x3a },
  doge: { symbol: "DOGE", hrp: null, p2pkh: 0x1e, p2sh: 0x16 },
  "doge-testnet": { symbol: "tDOGE", hrp: null, p2pkh: 0x71, p2sh: 0xc4 },
};

const b58check = base58check(sha256);

function b58(version: number, hash: Uint8Array): string {
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(hash, 1);
  return b58check.encode(payload);
}

export function scriptToAddress(spk: Uint8Array, network: UtxoNetwork): string | null {
  const p = UTXO_NETWORKS[network];
  // P2PKH: OP_DUP OP_HASH160 PUSH20 <h> OP_EQUALVERIFY OP_CHECKSIG
  if (spk.length === 25 && spk[0] === 0x76 && spk[1] === 0xa9 && spk[2] === 0x14 && spk[23] === 0x88 && spk[24] === 0xac) {
    return b58(p.p2pkh, spk.slice(3, 23));
  }
  // P2SH: OP_HASH160 PUSH20 <h> OP_EQUAL
  if (spk.length === 23 && spk[0] === 0xa9 && spk[1] === 0x14 && spk[22] === 0x87) return b58(p.p2sh, spk.slice(2, 22));
  if (!p.hrp || spk.length < 4 || spk.length !== 2 + spk[1]) return null;
  const program = spk.slice(2);
  if (spk[0] === 0x00 && (program.length === 20 || program.length === 32)) return bech32.encode(p.hrp, [0, ...bech32.toWords(program)]);
  if (spk[0] >= 0x51 && spk[0] <= 0x60 && program.length >= 2 && program.length <= 40) {
    return bech32m.encode(p.hrp, [spk[0] - 0x50, ...bech32m.toWords(program)]);
  }
  return null;
}
