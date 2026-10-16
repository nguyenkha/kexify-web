// Segwit address <-> witness scriptPubKey (BIP173 bech32 for v0, BIP350 bech32m for v1+).
// One decoder for BTC and LTC so address validation and output building can never disagree.
// Only the output types we can safely build are accepted: v0 + 20 (P2WPKH), v0 + 32 (P2WSH),
// v1 + 32 (P2TR). Anything else throws instead of producing a script that burns the coins.

import { bech32, bech32m } from "@scure/base";

export interface SegwitProgram {
  hrp: string;
  version: number;
  program: Uint8Array;
}

/** Decode a segwit address whose HRP must be one of `hrps`; throws on anything we cannot pay to. */
export function decodeSegwitAddress(address: string, hrps: readonly string[]): SegwitProgram {
  const addr = address as `${string}1${string}`;
  // The checksum variant is fixed by the witness version (BIP350): v0 = bech32, v1+ = bech32m.
  // decodeUnsafe also rejects mixed case and strings over 90 chars.
  const v0 = bech32.decodeUnsafe(addr);
  const decoded = v0 && v0.words[0] === 0 ? { ...v0, codec: bech32 } : (() => {
    const m = bech32m.decodeUnsafe(addr);
    return m && m.words.length > 0 && m.words[0] !== 0 ? { ...m, codec: bech32m } : null;
  })();
  if (!decoded) throw new Error("Invalid segwit address");

  const hrp = decoded.prefix.toLowerCase();
  if (!hrps.includes(hrp)) throw new Error(`Address prefix "${hrp}" is not valid for this network`);

  const version = decoded.words[0];
  if (version > 16) throw new Error("Invalid segwit version");
  const program = new Uint8Array(decoded.codec.fromWords(decoded.words.slice(1)));

  if (version === 0 && (program.length === 20 || program.length === 32)) return { hrp, version, program };
  if (version === 1 && program.length === 32) return { hrp, version, program };
  throw new Error(`Unsupported segwit output (version ${version}, ${program.length}-byte program)`);
}

/** OP_n PUSH_len <program>: v0 -> 00 14|20 <prog>, v1 -> 51 20 <prog>. */
export function segwitScriptPubKey({ version, program }: SegwitProgram): Uint8Array {
  const spk = new Uint8Array(2 + program.length);
  spk[0] = version === 0 ? 0x00 : 0x50 + version;
  spk[1] = program.length;
  spk.set(program, 2);
  return spk;
}
