// BTC/LTC address -> scriptPubKey: BIP173 / BIP350 vectors, network checks, and validation == building.
import { describe, expect, test } from "bun:test";
import { base58check, bech32, bech32m } from "@scure/base";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "../../shared/utils";
import * as btc from "./btcTx";
import * as ltc from "./ltcTx";

const b58 = base58check(sha256);
const hex = (a: string, f: (x: string) => Uint8Array) => bytesToHex(f(a));

const P2WPKH_PROG = "751e76e8199196d454941c45d1b3a323f1433bd6";
const P2WSH_PROG = "1863143c14c5166804bd19203356da136c985678cd4d27a1b8c6329604903262";
const P2TR_PROG = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

const BTC_VALID: [string, string][] = [
  // BIP173
  ["BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4", `0014${P2WPKH_PROG}`],
  ["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", `0014${P2WPKH_PROG}`],
  ["bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", `0020${P2WSH_PROG}`],
  ["tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7", `0020${P2WSH_PROG}`],
  ["tb1qqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesrxh6hy", "0020000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433"],
  // BIP350
  ["bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", `5120${P2TR_PROG}`],
  ["tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c", "5120000000c4a5cad46221b2a187905e5266362b99d5e91c6ce24d165dab93e86433"],
  // Base58
  ["1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2", "76a91477bff20c60e522dfaa3350c39b030a5d004e839a88ac"],
  ["3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", "a914b472a266d0bd89c13706a4132ccfb16f7c3b9fcb87"],
];

const BTC_INVALID: [string, string][] = [
  ["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh", "v0 with a bech32m checksum (BIP350)"],
  ["bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd", "v1 with a bech32 checksum (BIP350)"],
  ["tb1z0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqglt7rf", "v2 with a bech32 checksum"],
  ["BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P", "v0 with a 16-byte program"],
  ["tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sL5k7", "mixed case"],
  ["bc1zw508d6qejxtdg4y5r3zarvaryvqyzf3du", "non-zero padding"],
  ["bc1gmk9yu", "empty data"],
  ["bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y", "v1 with a 40-byte program (not taproot)"],
  ["bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs", "v2 (unsupported witness version)"],
  ["BC1SW50QGDZ25J", "v16 (unsupported witness version)"],
  ["tc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vq5zuyut", "unknown HRP"],
  [bech32.encode("ltc", [0, ...bech32.toWords(hexToBytes(P2WPKH_PROG))]), "LTC address on BTC"],
  [b58.encode(new Uint8Array([0x30, ...hexToBytes(P2WPKH_PROG)])), "LTC P2PKH on BTC"],
  [b58.encode(new Uint8Array([0x00, ...hexToBytes(P2WPKH_PROG), 0x00])), "base58 payload of 22 bytes"],
  ["", "empty"],
];

describe("BTC addressToScriptPubKey", () => {
  for (const [addr, spk] of BTC_VALID) {
    test(`valid ${addr}`, () => {
      expect(hex(addr, btc.addressToScriptPubKey)).toBe(spk);
      expect(btc.isValidBtcAddress(addr)).toBe(true);
    });
  }
  for (const [addr, why] of BTC_INVALID) {
    test(`rejects ${why}`, () => {
      expect(() => btc.addressToScriptPubKey(addr)).toThrow();
      expect(btc.isValidBtcAddress(addr)).toBe(false);
    });
  }
  test("P2WSH builds OP_0 PUSH_32 (regression: was 00 14 + 32 bytes)", () => {
    const spk = btc.addressToScriptPubKey("bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3");
    expect(spk.length).toBe(34);
    expect([spk[0], spk[1]]).toEqual([0x00, 0x20]);
  });
  test("network flag", () => {
    expect(btc.parseBtcAddress("tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7").testnet).toBe(true);
    expect(btc.parseBtcAddress("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn").testnet).toBe(true);
    expect(btc.parseBtcAddress("2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc").testnet).toBe(true);
    expect(btc.parseBtcAddress("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0").testnet).toBe(false);
  });
});

// LTC vectors: same programs under the LTC HRPs / version bytes.
const seg = (hrp: string, v: number, prog: string) =>
  (v === 0 ? bech32 : bech32m).encode(hrp, [v, ...(v === 0 ? bech32 : bech32m).toWords(hexToBytes(prog))]);
const b58v = (ver: number) => b58.encode(new Uint8Array([ver, ...hexToBytes(P2WPKH_PROG)]));

const LTC_VALID: [string, string, boolean][] = [
  [seg("ltc", 0, P2WPKH_PROG), `0014${P2WPKH_PROG}`, false],
  [seg("tltc", 0, P2WPKH_PROG), `0014${P2WPKH_PROG}`, true],
  [seg("ltc", 0, P2WSH_PROG), `0020${P2WSH_PROG}`, false],
  [seg("tltc", 0, P2WSH_PROG), `0020${P2WSH_PROG}`, true],
  [seg("ltc", 1, P2TR_PROG), `5120${P2TR_PROG}`, false],
  [seg("tltc", 1, P2TR_PROG), `5120${P2TR_PROG}`, true],
  [b58v(0x30), `76a914${P2WPKH_PROG}88ac`, false],
  [b58v(0x6f), `76a914${P2WPKH_PROG}88ac`, true],
  [b58v(0x32), `a914${P2WPKH_PROG}87`, false],
  [b58v(0xc4), `a914${P2WPKH_PROG}87`, true],
];

const LTC_INVALID: [string, string][] = [
  ["bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", "BTC address on LTC"],
  [seg("ltc", 1, P2WPKH_PROG), "v1 with a 20-byte program"],
  [seg("ltc", 2, P2TR_PROG), "v2 (unsupported witness version)"],
  [bech32.encode("ltc", [1, ...bech32.toWords(hexToBytes(P2TR_PROG))]), "v1 with a bech32 checksum"],
  [bech32m.encode("ltc", [0, ...bech32m.toWords(hexToBytes(P2WSH_PROG))]), "v0 with a bech32m checksum"],
  [bech32.encode("ltc", [0, ...bech32.toWords(hexToBytes(P2WSH_PROG.slice(0, 48)))]), "v0 with a 24-byte program"],
  [b58v(0x00), "BTC P2PKH on LTC"],
  [b58v(0x05), "BTC P2SH on LTC"],
];

describe("LTC addressToScriptPubKey", () => {
  for (const [addr, spk, testnet] of LTC_VALID) {
    test(`valid ${addr}`, () => {
      expect(hex(addr, ltc.addressToScriptPubKey)).toBe(spk);
      expect(ltc.parseLtcAddress(addr).testnet).toBe(testnet);
      expect(ltc.isValidLtcAddress(addr)).toBe(true);
    });
  }
  for (const [addr, why] of LTC_INVALID) {
    test(`rejects ${why}`, () => {
      expect(() => ltc.addressToScriptPubKey(addr)).toThrow();
      expect(ltc.isValidLtcAddress(addr)).toBe(false);
    });
  }
});

describe("build refuses a cross-network recipient", () => {
  const utxos = [{ txid: "11".repeat(32), vout: 0, value: 100_000, status: { confirmed: true } }] as btc.UTXO[];
  const changeMain = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
  test("BTC testnet recipient from a mainnet wallet", () => {
    expect(() => btc.buildBtcTransaction("tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7", 10_000n, utxos, 1, changeMain))
      .toThrow(/different network/);
  });
  test("BTC P2WSH send puts a 34-byte witness output", () => {
    const tx = btc.buildBtcTransaction("bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", 10_000n, utxos, 1, changeMain);
    expect(bytesToHex(tx.outputs[0].scriptPubKey)).toBe(`0020${P2WSH_PROG}`);
  });
  test("LTC testnet recipient from a mainnet wallet", () => {
    expect(() => ltc.buildLtcTransaction(seg("tltc", 0, P2WSH_PROG), 10_000n, utxos, 1, seg("ltc", 0, P2WPKH_PROG)))
      .toThrow(/different network/);
  });
});
