// The review's copy of the EVM calldata decoder must read every calldata exactly as the API policy does, and the
// review must name approvals / transfers the policy sees (review finding P2: setApprovalForAll, increaseAllowance,
// unknown-token transfers, Permit2 approve, dirty padding).
import { describe, expect, test } from "bun:test";
import { evmLegs as apiLegs } from "../../../../api/src/policy/evm-calldata";
import { evmLegs } from "./evm-calldata-legs";
import { buildEvmTxReview } from "./build-evm-tx-review";

const SELF = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SPENDER = "0xdddddddddddddddddddddddddddddddddddddddd";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const w = (h: string) => h.replace(/^0x/, "").padStart(64, "0");
const n = (v: bigint) => v.toString(16).padStart(64, "0");
const MAX = "f".repeat(64);

const CORPUS: Array<[string, string]> = [
  [TOKEN, "a9059cbb" + w(SPENDER) + n(7n)],
  [TOKEN, "23b872dd" + w(SELF) + w(SPENDER) + n(9n)],
  [TOKEN, "23b872dd" + w(SPENDER) + w(SELF) + n(9n)],
  [TOKEN, "095ea7b3" + w(SPENDER) + MAX],
  [TOKEN, "095ea7b3" + "1".repeat(24) + SPENDER.slice(2) + MAX], // dirty padding
  [TOKEN, "095ea7b3" + w("0") + n(5n)],
  [TOKEN, "39509351" + w(SPENDER) + n(1n)],
  [TOKEN, "d73dd623" + w(SPENDER) + n(1n)],
  [TOKEN, "a22cb465" + w(SPENDER) + n(1n)],
  [TOKEN, "a22cb465" + w(SPENDER) + n(0n)],
  [TOKEN, "959b8c3f" + w(SPENDER)],
  [TOKEN, "42842e0e" + w(SELF) + w(SPENDER) + n(3n)],
  [PERMIT2, "87517c45" + w(TOKEN) + w(SPENDER) + n(10n) + n(0n)],
  [TOKEN, "3593564c" + "00".repeat(40)],
  [TOKEN, "a9059c"],
];

describe("EVM calldata legs", () => {
  test("same legs as the API policy on every calldata", () => {
    for (const [to, data] of CORPUS) expect(evmLegs(SELF, to, 0n, data)).toEqual(apiLegs(SELF, to, 0n, data));
  });

  const review = (to: string, data: string, token?: { symbol: string; decimals: number }) =>
    buildEvmTxReview({ tx: { to, data: "0x" + data }, from: { address: SELF }, nativeSymbol: "ETH", token, feeWei: 1n, prices: {} });

  test("setApprovalForAll(true) is a collection-wide NFT approval: red warning + extra confirm", () => {
    const m = review(TOKEN, "a22cb465" + w(SPENDER) + n(1n));
    expect(m.hero.icon).toBe("approve");
    expect(m.hero.tone).toBe("danger");
    expect(m.warnings.map((x) => x.code)).toEqual(["nftApprovalForAll"]);
    expect(m.extraConfirm).toBe("nftApprovalForAll");
    const revoke = review(TOKEN, "a22cb465" + w(SPENDER) + n(0n));
    expect(revoke.extraConfirm).toBeUndefined();
    expect(revoke.warnings.map((x) => x.code)).not.toContain("nftApprovalForAll");
    expect(m.allowance).toBeUndefined(); // not editable
  });

  test("increaseAllowance is unbounded; not editable", () => {
    const m = review(TOKEN, "39509351" + w(SPENDER) + n(1n), { symbol: "USDC", decimals: 6 });
    expect(m.warnings[0].code).toBe("unlimitedApproval");
    expect(m.allowance).toBeUndefined();
  });

  test("a transfer of an unlisted token still names the recipient in full", () => {
    const m = review(TOKEN, "a9059cbb" + w(SPENDER) + n(7n));
    expect(m.hero).toMatchObject({ icon: "send", amount: { key: "review.baseUnits", params: { amount: "7" } } });
    expect(m.rows.find((r) => r.fullAddress)?.party?.address.toLowerCase()).toBe(SPENDER);
  });

  test("Permit2 approve names the token it approves", () => {
    const m = review(PERMIT2, "87517c45" + w(TOKEN) + w(SPENDER) + n(10n) + n(0n));
    expect(m.hero.icon).toBe("approve");
    expect(m.rows.map((r) => (r.label as { key: string }).key)).toContain("review.contract");
  });

  test("dirty-padded approve: the policy reads no approval, so neither does the review (no editor)", () => {
    const m = review(TOKEN, "095ea7b3" + "1".repeat(24) + SPENDER.slice(2) + MAX, { symbol: "USDC", decimals: 6 });
    expect(m.hero.icon).toBe("contract");
    expect(m.allowance).toBeUndefined();
  });

  test("an edited cap shows in the raw data as it will be signed", () => {
    const m = buildEvmTxReview({ tx: { to: TOKEN, data: "0x095ea7b3" + w(SPENDER) + MAX }, from: { address: SELF }, nativeSymbol: "ETH", token: { symbol: "USDC", decimals: 6 }, approveOverride: 5n, feeWei: 1n, prices: {} });
    expect(m.raw?.endsWith(n(5n))).toBe(true);
  });
});

