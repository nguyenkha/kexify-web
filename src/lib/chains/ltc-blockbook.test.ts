// LTC mainnet send reads: Blockbook first, litecoinspace.org Esplora as fallback; testnet stays on
// Esplora. Fixture: a real Blockbook /api/v2/utxo response (first two rows, fetched 2026-10-18).
import { afterEach, describe, expect, test } from "bun:test";
import utxoFixture from "./fixtures/ltc-blockbook-utxo.json";
import { broadcastLtcTx, fetchUtxos, ltcApiUrl, waitForLtcConfirmation } from "./ltcTx";
import { ltcBlockbookFor, rawTxid } from "./ltc-blockbook";

const MAINNET = ltcApiUrl("https://litecoinspace.org");
const TESTNET = ltcApiUrl("https://litecoinspace.org/testnet");
const ADDR = "LQ3B36Yv2rBTxdgAdYpU2UcEZsaNwXeATk";
const TXID = "ab".repeat(32);
/** Real LTC mainnet SegWit tx (Blockbook /tx hex, 2026-10-18) and its txid. */
const RAW = "020000000001011d8723676502ea29f0831732db8b3cb71a8a602c671d49afbbee46ac6cb6f3750000000000fdffffff02848e06000000000016001444d035df2b25954cb2fc911f8bfa8ae367296ee840420f00000000001976a91434ceb766f9db4e9c7fe48f6e336f628ff40aada788ac02473044022032df4d3d22840caeaebd63b2d6164e383d045b73ae644f9c3384efafc643688c02206b0a864f721ed322a78ec59c871581c22b513dceced3a1ff661ffe7672929369012102272bcab13e130ecfaa7808430c71238efe9264de51e6f2b96f0b3bbee64d9612afb02f00";
const RAW_TXID = "2003c2a03dc776e00375cfa956f7fa3d73f387dd38bf85ee9228ff9d361ed819";
const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Stub fetch per host; returns the URLs asked, in order. */
function stub(bb: (url: string) => Response, esplora: (url: string) => Response): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return new URL(url).host === "litecoinblockexplorer.net" ? bb(url) : esplora(url);
  }) as typeof fetch;
  return calls;
}
afterEach(() => { globalThis.fetch = realFetch; });

describe("LTC Blockbook-first send path", () => {
  test("only the mainnet litecoinspace base maps to Blockbook", () => {
    expect(ltcBlockbookFor(MAINNET)).toBe("https://litecoinblockexplorer.net/api/v2");
    expect(ltcBlockbookFor(TESTNET)).toBeNull();
    expect(ltcBlockbookFor("https://example.org/api")).toBeNull();
  });

  test("mainnet UTXOs come from Blockbook in Esplora shape", async () => {
    const calls = stub(() => json([...utxoFixture, { ...utxoFixture[0], vout: 3, confirmations: 0, height: undefined }]), () => { throw new Error("not reached"); });
    const utxos = await fetchUtxos(ADDR, MAINNET);
    expect(calls).toEqual([`https://litecoinblockexplorer.net/api/v2/utxo/${ADDR}`]);
    expect(utxos[0]).toEqual({ txid: utxoFixture[0].txid, vout: 1, value: 1_000_000, status: { confirmed: true, block_height: 3125424 } });
    expect(utxos[1].value).toBe(534_900);
    expect(utxos[2].status).toEqual({ confirmed: false, block_height: undefined });
  });

  test("Blockbook down or malformed falls back to Esplora; testnet never asks Blockbook", async () => {
    const esploraRows = [{ txid: TXID, vout: 0, value: 5, status: { confirmed: true } }];
    for (const bb of [() => json({ error: "busy" }, 503), () => json([{ ...utxoFixture[0], value: 1000000 }])]) {
      const calls = stub(bb, () => json(esploraRows));
      expect(await fetchUtxos(ADDR, MAINNET)).toEqual(esploraRows);
      expect(calls[1]).toBe(`${MAINNET}/address/${ADDR}/utxo`);
    }
    const calls = stub(() => { throw new Error("not reached"); }, () => json(esploraRows));
    await fetchUtxos(ADDR, TESTNET);
    expect(calls).toEqual([`${TESTNET}/address/${ADDR}/utxo`]);
  });

  test("broadcast: Blockbook result is the txid; on its error Esplora relays; both failing names both", async () => {
    let calls = stub(() => json({ result: TXID }), () => { throw new Error("not reached"); });
    expect(await broadcastLtcTx("0200", MAINNET)).toBe(TXID);
    expect(calls).toEqual(["https://litecoinblockexplorer.net/api/v2/sendtx/"]);

    calls = stub(() => json({ error: "busy" }, 503), () => new Response(TXID));
    expect(await broadcastLtcTx("0200", MAINNET)).toBe(TXID);
    expect(calls[1]).toBe(`${MAINNET}/tx`);

    stub(() => json({}, 502), () => new Response("sendrawtransaction RPC error", { status: 400 }));
    await expect(broadcastLtcTx("0200", MAINNET)).rejects.toThrow(/502.*RPC error/);
  });

  test("broadcast: a Blockbook node verdict is final (Esplora not asked)", async () => {
    const calls = stub(() => json({ error: "-26: min relay fee not met" }, 400), () => { throw new Error("not reached"); });
    await expect(broadcastLtcTx("0200", MAINNET)).rejects.toThrow("-26: min relay fee not met");
    expect(calls).toHaveLength(1);
  });

  test("broadcast: Esplora 'already known' after a Blockbook no-verdict is success with the local txid", async () => {
    for (const dup of ["sendrawtransaction RPC error: {\"code\":-27,\"message\":\"Transaction already in block chain\"}", "txn-already-in-mempool"]) {
      stub(() => json({}, 504), () => new Response(dup, { status: 400 }));
      expect(await broadcastLtcTx(RAW, MAINNET)).toBe(RAW_TXID);
    }
    // Without a Blockbook attempt (testnet) the same answer stays an error, as before.
    stub(() => { throw new Error("not reached"); }, () => new Response("txn-already-in-mempool", { status: 400 }));
    await expect(broadcastLtcTx(RAW, TESTNET)).rejects.toThrow("txn-already-in-mempool");
  });

  test("rawTxid strips SegWit marker, flag and witnesses (real mainnet tx); truncated hex throws", () => {
    expect(rawTxid(RAW)).toBe(RAW_TXID);
    expect(() => rawTxid(RAW.slice(0, 120))).toThrow("truncated");
  });

  test("broadcast: a Blockbook duplicate verdict (re-broadcast) is success with the local txid", async () => {
    stub(() => json({ error: "-27: Transaction already in block chain" }, 400), () => { throw new Error("not reached"); });
    expect(await broadcastLtcTx(RAW, MAINNET)).toBe(RAW_TXID);
  });

  test("confirmation: Blockbook height when mined, mempool keeps polling, failure asks Esplora", async () => {
    stub(() => json({ txid: TXID, confirmations: 2, blockHeight: 3196770 }), () => { throw new Error("not reached"); });
    expect(await waitForLtcConfirmation(TXID, undefined, 1, 0, MAINNET)).toEqual({ confirmed: true, blockHeight: 3196770 });

    const asked = stub(() => json({ txid: "00".repeat(32), confirmations: 2, blockHeight: 1 }), () => json({ status: { confirmed: false } }));
    expect(await waitForLtcConfirmation(TXID, undefined, 1, 0, MAINNET)).toEqual({ confirmed: false }); // answer for another tx
    expect(asked).toHaveLength(2);

    let calls = stub(() => json({ txid: TXID, confirmations: 0 }), () => { throw new Error("not reached"); });
    expect(await waitForLtcConfirmation(TXID, undefined, 2, 0, MAINNET)).toEqual({ confirmed: false });
    expect(calls).toHaveLength(2);

    calls = stub(() => json({ error: `Transaction '${TXID}' not found` }, 400), () => json({ status: { confirmed: true, block_height: 9 } }));
    expect(await waitForLtcConfirmation(TXID, undefined, 1, 0, MAINNET)).toEqual({ confirmed: true, blockHeight: 9 });
    expect(calls[1]).toBe(`${MAINNET}/tx/${TXID}`);
  });
});
