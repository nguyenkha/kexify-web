// The web sheet's TRON decoder must read the same thing the API's strict parser reads from the same bytes,
// and refuse what it refuses (needs api/node_modules, as the iOS chain bundle does).
import { describe, expect, test } from "bun:test";
import { parseTronRawData } from "../../../../api/src/chains/tron-raw-data-parser";
import { FROM, TO, USDT, addr, contract, fBytes, fVarint, rawData, trc20Call, trxTransfer } from "../../../../api/src/chains/tron-test-fixtures";
import { decodeTronRawData } from "./tron-raw-data-decoder";

const MAX = (1n << 256n) - 1n;

/** Both parsers on the same bytes: equal readings, or both throw. */
function agree(raw: Uint8Array) {
  let api: ReturnType<typeof parseTronRawData> | Error;
  let web: ReturnType<typeof decodeTronRawData> | Error;
  try { api = parseTronRawData(raw); } catch (e) { api = e as Error; }
  try { web = decodeTronRawData(raw); } catch (e) { web = e as Error; }
  if (api instanceof Error || web instanceof Error) {
    expect([api instanceof Error, web instanceof Error]).toEqual([true, true]);
    return null;
  }
  expect({ kind: web.kind, owner: web.owner, to: web.to, amount: web.amount.toString(), contractAddress: web.contractAddress ?? undefined, feeLimit: web.feeLimit })
    .toEqual({ kind: api.kind, owner: api.owner, to: api.to, amount: api.amount, contractAddress: api.contractAddress, feeLimit: api.feeLimit });
  expect(web.unlimited).toBe(api.unlimited === true);
  return web;
}

describe("web TRON decoder agrees with the API parser", () => {
  test("TRX transfer, TRC-20 transfer, TRC-20 approve (limited / unlimited)", () => {
    expect(agree(rawData(trxTransfer(FROM, TO, 1_500_000)))?.kind).toBe("trx_transfer");
    expect(agree(rawData(trc20Call(FROM, USDT, "a9059cbb", TO, 5n)))?.kind).toBe("trc20_transfer");
    expect(agree(rawData(trc20Call(FROM, USDT, "095ea7b3", TO, 5n)))).toMatchObject({ kind: "trc20_approve", to: TO, amount: 5n, unlimited: false });
    expect(agree(rawData(trc20Call(FROM, USDT, "095ea7b3", TO, MAX)))).toMatchObject({ kind: "trc20_approve", unlimited: true });
    expect(agree(rawData(trc20Call(FROM, USDT, "a9059cbb", TO, MAX)))?.unlimited).toBe(false);
  });

  test("both refuse the same malformed or unsupported bytes", () => {
    const call = (data: number[], extra: number[] = []) =>
      rawData(contract(31, "TriggerSmartContract", [...fBytes(1, addr(FROM)), ...fBytes(2, addr(USDT)), ...extra, ...fBytes(4, data)]));
    const approve = [...Buffer.from("095ea7b3", "hex"), ...new Array(12).fill(0), ...addr(TO).slice(1), ...new Array(32).fill(1)];
    const dirty = [...approve];
    dirty[4] = 0x41;
    const cases = [
      call(approve.slice(0, 67)), call([...approve, 0]), call(dirty), call(approve, fVarint(3, 1)),
      rawData(trc20Call(FROM, USDT, "d73dd623", TO, 1n)), rawData(trc20Call(FROM, USDT, "39509351", TO, 1n)),
      rawData(trc20Call(FROM, USDT, "23b872dd", TO, 1n)), rawData(trxTransfer(FROM, TO, 1), trxTransfer(FROM, TO, 2)),
      rawData(trxTransfer(FROM, TO, 0)), new Uint8Array([...rawData(trxTransfer(FROM, TO, 1)), ...fBytes(9, [1])]),
      rawData(contract(1, "TransferContract", [...fBytes(1, addr(FROM)), ...fBytes(2, addr(TO)), ...fVarint(3, 5)], fVarint(5, 2))),
      rawData(contract(46, "AccountPermissionUpdateContract", [...fBytes(1, addr(FROM))])),
      new Uint8Array([0x0a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]),
    ];
    for (const raw of cases) expect(agree(raw)).toBeNull();
  });
});
