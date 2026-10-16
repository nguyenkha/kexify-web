// Typed data the server's policy treats as approvals / transfers must read as such on the review (P1 review
// finding): same known-format table as the API, checked against the API's own canonicalFormat.
import { describe, expect, test } from "bun:test";
import { canonicalFormat as apiFormat } from "../../../../api/src/policy/typed-data-formats";
import { canonicalFormat, type TypeDefs } from "./typed-data-known-formats";
import { buildTypedDataReview } from "./build-signature-review";

const FROM = { address: "0x1111111111111111111111111111111111111111" };
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const DRAINER = "0xdddddddddddddddddddddddddddddddddddddddd";
const tokenOf = (a: string) => (a.toLowerCase() === USDC.toLowerCase() ? { symbol: "USDC", decimals: 6 } : undefined);
const f = (s: string) => s.split(",").map((x) => { const [type, name] = x.split(" "); return { type, name }; });
const TYPES: Record<string, TypeDefs> = {
  Permit: { Permit: f("address owner,address spender,uint256 value,uint256 nonce,uint256 deadline") },
  DaiPermit: { Permit: f("address holder,address spender,uint256 nonce,uint256 expiry,bool allowed") },
  Erc721Permit: { Permit: f("address spender,uint256 tokenId,uint256 nonce,uint256 deadline") },
  PermitForAll: { PermitForAll: f("address owner,address operator,bool approved,uint256 nonce,uint256 deadline") },
  PermitTransferFrom: { PermitTransferFrom: f("TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline"), TokenPermissions: f("address token,uint256 amount") },
  PermitBatchTransferFrom: { PermitBatchTransferFrom: f("TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline"), TokenPermissions: f("address token,uint256 amount") },
  Eip3009: { TransferWithAuthorization: f("address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce") },
  LookAlike: { Permit: f("address owner,address spender,uint256 value,uint256 deadline") },
};
const primary = (t: TypeDefs) => Object.keys(t).find((k) => k !== "TokenPermissions" && k !== "PermitDetails")!;
const review = (types: TypeDefs, message: Record<string, unknown>, verifyingContract = USDC) =>
  buildTypedDataReview({ typedData: { types, primaryType: primary(types), domain: { name: "x", verifyingContract }, message }, from: FROM, tokenOf, prices: { USDC: 1 } });

describe("known typed-data formats", () => {
  test("same verdict as the API's canonicalFormat for every known format and a look-alike", () => {
    for (const types of Object.values(TYPES)) expect(canonicalFormat(primary(types), types)).toBe(apiFormat(primary(types), types));
    expect(canonicalFormat("Permit", TYPES.LookAlike)).toBeNull();
  });

  test("Permit2 PermitTransferFrom (signature transfer) of all USDC is an unlimited approval", () => {
    const m = review(TYPES.PermitTransferFrom, { permitted: { token: USDC, amount: (2n ** 256n - 1n).toString() }, spender: DRAINER, nonce: "1", deadline: "1763000000" }, PERMIT2);
    expect(m.hero).toMatchObject({ icon: "approve", amount: { key: "review.unlimited", params: { symbol: "USDC" } } });
    expect(m.warnings.map((w) => w.code)).toEqual(["unlimitedApproval"]);
    expect(m.rows.find((r) => r.fullAddress)?.party?.address).toBe(DRAINER);
  });

  test("PermitBatchTransferFrom lists each token", () => {
    const m = review(TYPES.PermitBatchTransferFrom, { permitted: [{ token: USDC, amount: "5000000" }, { token: DRAINER, amount: "1" }], spender: DRAINER, nonce: "1", deadline: "1" }, PERMIT2);
    expect(m.actions).toHaveLength(2);
    expect(m.warnings.map((w) => w.code)).toEqual(["approval"]);
  });

  test("DaiPermit allowed=true is unlimited; allowed=false is a revoke", () => {
    expect(review(TYPES.DaiPermit, { holder: FROM.address, spender: DRAINER, nonce: "0", expiry: "0", allowed: true }).warnings[0].code).toBe("unlimitedApproval");
    const revoke = review(TYPES.DaiPermit, { holder: FROM.address, spender: DRAINER, nonce: "0", expiry: "0", allowed: false });
    expect(revoke.hero.verb).toEqual({ key: "review.verb.revoke" });
    expect(revoke.warnings).toEqual([]);
  });

  test("PermitForAll approved and ERC-721 permit are approvals", () => {
    const all = review(TYPES.PermitForAll, { owner: FROM.address, operator: DRAINER, approved: true, nonce: "0", deadline: "1" });
    expect(all.warnings[0]).toMatchObject({ code: "nftApprovalForAll", tone: "danger", blocks: false });
    expect(all.extraConfirm).toBe("nftApprovalForAll");
    const nft = review(TYPES.Erc721Permit, { spender: DRAINER, tokenId: "42", nonce: "0", deadline: "1" }, DRAINER);
    expect(nft.warnings.map((w) => w.code)).toEqual(["approval"]);
    expect(nft.hero.amount).toEqual({ text: "0xdddd…dddd #42" });
  });

  test("EIP-3009 TransferWithAuthorization is a send with the recipient in full", () => {
    const m = review(TYPES.Eip3009, { from: FROM.address, to: DRAINER, value: "25000000", validAfter: "0", validBefore: "1763000000", nonce: "0x" + "00".repeat(32) });
    expect(m.hero).toMatchObject({ icon: "send", amount: { text: "25 USDC" }, usd: 25 });
    expect(m.rows.find((r) => r.fullAddress)?.party?.address).toBe(DRAINER);
  });

  test("a look-alike Permit is not shown as an approval", () => {
    expect(review(TYPES.LookAlike, { owner: FROM.address, spender: DRAINER, value: "1", deadline: "1" }).hero.icon).toBe("sign");
  });
});

describe("unlimited fungible permits", () => {
  test("an unlimited EIP-2612 permit blocks Confirm (the server signs none)", () => {
    const m = review(TYPES.Permit, { owner: FROM.address, spender: DRAINER, value: (2n ** 256n - 1n).toString(), nonce: "0", deadline: "1" });
    expect(m.warnings[0]).toMatchObject({ code: "unlimitedApproval", blocks: true });
  });
});
