import { describe, expect, test } from "bun:test";
import type { DecodedSolanaIx } from "../chains/solanaIx";
import type { DecodedSolanaTx } from "../chains/solanaTx";
import {
  buildEvmTxReview, buildMessageReview, buildSendReview, buildSolanaReview, buildTronReview, buildTypedDataReview,
  buildWcRequestReview, checksumEvmAddress, decodeEvmCall, groupAddress, knownEvmContract, shortAddress, type Label, type ReviewModel,
} from ".";

const FROM = { address: "0x8f3C2b6E00000000000000000000000000E1F2", name: "Main wallet" };
const TO = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const prices = { ETH: 3000, USDC: 1, SOL: 150, TRX: 0.2 };
const usdc = { symbol: "USDC", decimals: 6 };
const word = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const text = (l: Label | undefined) => (l && "text" in l ? l.text : l?.key);
const codes = (m: ReviewModel) => m.warnings.map((w) => w.code);

describe("address formatting", () => {
  test("groups of 4 keep 0x apart", () => {
    expect(groupAddress(TO)).toEqual(["0x", "3fC9", "1A3a", "fd70", "395C", "d496", "C647", "d5a6", "CC9D", "4B2b", "7FAD"]);
    expect(groupAddress("8qbHbw2BbbTHBW1s")).toEqual(["8qbH", "bw2B", "bbTH", "BW1s"]);
  });
  test("short form is first 6 … last 4", () => expect(shortAddress(TO)).toBe("0x3fC9…7FAD"));
  test("known contract names", () => expect(knownEvmContract(TO)).toBe("Uniswap Universal Router"));
  test("EIP-55 checksum", () => {
    expect(checksumEvmAddress(TO.toLowerCase())).toBe(TO);
    expect(checksumEvmAddress(PERMIT2.toLowerCase())).toBe(PERMIT2);
    expect(checksumEvmAddress("TNotEvm")).toBe("TNotEvm");
  });
});

describe("EVM transaction", () => {
  test("native send: hero, full recipient, fee and total in fiat", () => {
    const m = buildEvmTxReview({ tx: { to: TO, value: "0x" + (25n * 10n ** 16n).toString(16) }, from: FROM, nativeSymbol: "ETH", feeWei: 420_000_000_000_000n, prices, firstTimeRecipient: true });
    expect(m.hero.icon).toBe("send");
    expect(text(m.hero.amount)).toBe("0.25 ETH");
    expect(m.hero.usd).toBeCloseTo(750);
    expect(m.rows.find((r) => r.fullAddress)?.party?.address).toBe(TO);
    expect(m.fee).toMatchObject({ amount: "0.00042 ETH" });
    expect(m.fee?.usd).toBeCloseTo(1.26);
    expect(m.total).toMatchObject({ native: "0.25042 ETH" });
    expect(m.total?.usd).toBeCloseTo(751.26);
    expect(codes(m)).toEqual(["firstTimeRecipient"]);
  });

  test("ERC-20 unlimited approve: warning, spender full, balance at risk", () => {
    const data = "0x095ea7b3" + word(PERMIT2) + "f".repeat(64);
    const m = buildEvmTxReview({ tx: { to: USDC, data }, from: FROM, nativeSymbol: "ETH", token: usdc, tokenBalance: "1,250 USDC", feeWei: 180_000_000_000_000n, prices, nameOf: knownEvmContract });
    expect(m.hero).toMatchObject({ icon: "approve", amount: { key: "review.unlimited", params: { symbol: "USDC" } }, sub: { key: "review.balanceAtRisk" } });
    expect(m.hero.counterparty?.party.name).toBe("Uniswap Permit2");
    expect(m.warnings[0]).toMatchObject({ code: "unlimitedApproval", tone: "warning", params: { spender: "Uniswap Permit2", symbol: "USDC" } });
    expect(m.rows.find((r) => r.fullAddress)?.party?.address).toBe(PERMIT2);
    expect(m.raw).toBe(data);
    // Approve moves no tokens: the total is the fee only.
    expect(m.total?.parts).toEqual(["0.00018 ETH"]);
  });

  test("approve edited to a limit uses the override", () => {
    const data = "0x095ea7b3" + word(PERMIT2) + "f".repeat(64);
    const m = buildEvmTxReview({ tx: { to: USDC, data }, from: FROM, nativeSymbol: "ETH", token: usdc, approveOverride: 500_000_000n, feeWei: null, prices });
    expect(text(m.hero.amount)).toBe("500 USDC");
    expect(codes(m)).toEqual(["approval"]);
    expect(m.fee?.loading).toBe(true);
  });

  test("approve of 0 on an unknown contract stays an approval (could be ERC-721 id 0)", () => {
    const m = buildEvmTxReview({ tx: { to: TO, data: "0x095ea7b3" + word(PERMIT2) + "0".repeat(64) }, from: FROM, nativeSymbol: "ETH", feeWei: 1n, prices });
    expect(m.hero.verb).toEqual({ key: "review.verb.approve" });
    expect(codes(m)).toEqual(["approval"]);
  });

  test("approve of 0 is a revoke without warning", () => {
    const m = buildEvmTxReview({ tx: { to: USDC, data: "0x095ea7b3" + word(PERMIT2) + "0".repeat(64) }, from: FROM, nativeSymbol: "ETH", token: usdc, feeWei: 1n, prices });
    expect(m.hero.verb).toEqual({ key: "review.verb.revoke" });
    expect(m.warnings).toEqual([]);
  });

  test("ERC-20 transfer of a known token: token amount + fee, no fiat when one part is unpriced", () => {
    const data = "0xa9059cbb" + word(TO) + (5_000_000n).toString(16).padStart(64, "0");
    const m = buildEvmTxReview({ tx: { to: USDC, data }, from: FROM, nativeSymbol: "ETH", token: usdc, feeWei: 10n ** 15n, prices: { USDC: 1 } });
    expect(text(m.hero.amount)).toBe("5 USDC");
    expect(m.total).toMatchObject({ usd: undefined, parts: ["5 USDC", "0.001 ETH"] });
  });

  test("unknown calldata is a contract call with the contract in full", () => {
    const m = buildEvmTxReview({ tx: { to: TO, data: "0x3593564c" + "00".repeat(40) }, from: FROM, nativeSymbol: "ETH", feeWei: 1n, prices, nameOf: knownEvmContract });
    expect(m.hero).toMatchObject({ icon: "contract", amount: { key: "review.noValue", params: { symbol: "ETH" } } });
    expect(m.rows.find((r) => r.fullAddress)?.party).toEqual({ address: TO, name: "Uniswap Universal Router" });
  });

  test("calldata with a dirty address word is not treated as ERC-20", () => {
    expect(decodeEvmCall("0xa9059cbb" + "1".repeat(24) + "0".repeat(40) + "0".repeat(64)).kind).toBe("contract");
  });

  test("policy block and risky address come first and block", () => {
    const m = buildEvmTxReview({ tx: { to: TO, value: "0x1" }, from: FROM, nativeSymbol: "ETH", feeWei: 1n, prices, firstTimeRecipient: true, policy: { allowed: false, blockedLeg: "transfer", fraudCheck: { flagged: true } } });
    expect(codes(m)).toEqual(["policyBlocked", "riskyAddress", "firstTimeRecipient"]);
    expect(m.warnings[0]).toMatchObject({ tone: "danger", blocks: true, params: { leg: "transfer" } });
  });
});

describe("typed data", () => {
  const types = {
    PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
    PermitBatch: [{ name: "details", type: "PermitDetails[]" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
    PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
    Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
  };
  const permitSingle = {
    types,
    primaryType: "PermitSingle",
    domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 },
    message: { details: { token: USDC, amount: "500000000", expiration: "1763164800", nonce: "0" }, spender: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af", sigDeadline: "1763000000" },
  };
  const tokenOf = (a: string) => (a.toLowerCase() === USDC.toLowerCase() ? usdc : undefined);

  test("Permit2 PermitSingle: allow spending, spender full, expiry, no fee", () => {
    const m = buildTypedDataReview({ typedData: JSON.stringify(permitSingle), from: FROM, chainId: 1, tokenOf, prices, nameOf: knownEvmContract });
    expect(m.hero).toMatchObject({ icon: "approve", amount: { text: "500 USDC" }, usd: 500 });
    expect(codes(m)).toEqual(["approval"]);
    expect(m.rows.map((r) => (r.label as { key: string }).key)).toEqual(["send.from", "review.spender", "review.token", "review.expires", "review.signedFor"]);
    expect(m.rows.find((r) => r.date)?.date).toBe(1763164800);
    expect(m.noFee).toBe("signature");
  });

  test("blocked by policy keeps the approval warning under the block", () => {
    const m = buildTypedDataReview({ typedData: permitSingle, from: FROM, chainId: 1, tokenOf, prices, policy: { allowed: false, blockedLeg: "approval" } });
    expect(codes(m)).toEqual(["policyBlocked", "approval"]);
    expect(m.warnings[0].blocks).toBe(true);
  });

  test("EIP-2612 Permit of max uint is unlimited; wrong chain warns", () => {
    const permit = { types, primaryType: "Permit", domain: { name: "USD Coin", chainId: 137, verifyingContract: USDC }, message: { owner: FROM.address, spender: PERMIT2, value: (2n ** 256n - 1n).toString(), deadline: "1763164800000" } };
    const m = buildTypedDataReview({ typedData: permit, from: FROM, chainId: 1, tokenOf, prices });
    expect(m.hero.amount).toEqual({ key: "review.unlimited", params: { symbol: "USDC" } });
    expect(codes(m)).toEqual(["unlimitedApproval", "wrongNetwork"]);
    expect(m.rows.find((r) => r.date)?.date).toBe(1763164800);
  });

  test("PermitBatch lists every token as an action", () => {
    const batch = { ...permitSingle, primaryType: "PermitBatch", message: { spender: PERMIT2, details: [{ token: USDC, amount: "1" }, { token: TO, amount: (2n ** 160n - 1n).toString() }] } };
    const m = buildTypedDataReview({ typedData: batch, from: FROM, tokenOf, prices });
    expect(m.actions).toHaveLength(2);
    expect(m.hero.amount).toEqual({ key: "review.tokenCount", params: { count: "2" } });
    expect(codes(m)).toEqual(["unlimitedApproval", "approval"]);
  });

  test("a permit whose fields are not declared in types is not shown as an approval", () => {
    const fake = { ...permitSingle, types: { PermitSingle: [{ name: "nonce", type: "uint256" }] } };
    const m = buildTypedDataReview({ typedData: fake, from: FROM, tokenOf, prices });
    expect(m.hero.icon).toBe("sign");
    expect(m.message).toContain("spender");
  });

  test("other typed data shows the whole message", () => {
    const order = { primaryType: "Order", domain: { name: "Seaport", verifyingContract: TO }, message: { offerer: FROM.address, salt: "1" } };
    const m = buildTypedDataReview({ typedData: order, from: FROM, tokenOf, prices });
    expect(m.hero).toMatchObject({ icon: "sign", verb: { key: "review.verb.signTyped", params: { type: "Order" } }, amount: { text: "Seaport" } });
    expect(m.message).toContain("offerer");
    expect(m.hero.noFundsMove).toBeUndefined();
  });
});

describe("messages", () => {
  test("SIWE shows the sign-in domain and no funds move", () => {
    const m = buildMessageReview({ kind: "personal", text: "app.uniswap.org wants you to sign in with your Ethereum account:\n0x8f3C\n\nNonce: 8c1f", from: FROM });
    expect(m.hero).toMatchObject({ verb: { key: "review.verb.signMessage" }, amount: { key: "review.signInTo", params: { domain: "app.uniswap.org" } }, noFundsMove: true });
    expect(m.message).toContain("Nonce: 8c1f");
    expect(m.warnings).toEqual([]);
  });
  test("plain message uses its first line", () => {
    expect(buildMessageReview({ kind: "tron", text: "\nHello TRON\nsecond", from: FROM }).hero.amount).toEqual({ text: "Hello TRON" });
  });
  test("eth_sign is a danger", () => {
    const m = buildMessageReview({ kind: "hash", text: "0x" + "ab".repeat(32), from: FROM });
    expect(m.warnings[0]).toMatchObject({ code: "signHash", tone: "danger" });
    expect(m.hero.noFundsMove).toBeUndefined();
  });
});

describe("Solana", () => {
  const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const ix = (p: Partial<DecodedSolanaIx>): DecodedSolanaIx => ({ type: "unknown", programId: "11111111111111111111111111111111", highRisk: false, ...p });
  const fee = { baseLamports: "5000", priorityLamports: "600", rentLamports: "2039280", totalLamports: "5600", costLamports: "2044880", policyLamports: "5600", capLamports: "10000000", exceedsCap: false, computeUnitLimit: 300000, computeUnitPrice: "2000" };
  const tx = (instructions: DecodedSolanaIx[]): DecodedSolanaTx => ({ type: "contract_call", from: WALLET, programs: [], numInstructions: instructions.length, isVersioned: false, instructions, numRequiredSignatures: 1, fee });
  const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const tokenOf = (a: string) => (a === MINT ? usdc : undefined);
  const multi = tx([
    ix({ type: "compute_budget", programId: "ComputeBudget111111111111111111111111111111", op: "setComputeUnitLimit", computeUnitLimit: 300000 }),
    ix({ type: "compute_budget", programId: "ComputeBudget111111111111111111111111111111", op: "setComputeUnitPrice", computeUnitPrice: "2000" }),
    ix({ type: "sol_transfer", from: WALLET, to: "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR", amount: "1000000" }),
    ix({ type: "spl_transfer", from: WALLET, to: "ATA1", destOwner: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9Ph2Lk", mint: MINT, decimals: 6, amount: "5000000" }),
    ix({ type: "ata_create", mint: MINT, destOwner: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9Ph2Lk" }),
    ix({ type: "memo", memo: "order #1234" }),
    ix({ type: "program", programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", programLabel: "Jupiter v6", highRisk: true }),
  ]);

  test("compute budget folds into the fee; every other instruction is an action", () => {
    const m = buildSolanaReview({ decoded: multi, from: { address: WALLET, name: "Main wallet" }, dappName: "Jupiter", tokenOf, prices });
    expect(m.actions.map((a) => a.icon)).toEqual(["send", "send", "create", "memo", "program"]);
    expect(m.fee).toMatchObject({ amount: "0.0000056 SOL", inclPriority: true, approx: true });
    expect(m.fee?.details?.map((r) => (r.label as { key: string }).key)).toEqual(["review.fee.base", "review.fee.priority", "review.fee.cuLimit", "review.fee.cuPrice", "review.fee.rent"]);
    expect(m.hero).toMatchObject({ icon: "stack", amount: { text: "−0.001 SOL · −5 USDC" } });
    expect(m.hero.usd).toBeCloseTo(5.15);
    expect(m.warnings).toEqual([expect.objectContaining({ code: "unknownProgram", params: { index: "5", program: "Jupiter v6", dapp: "Jupiter" } })]);
    expect(m.actions[4].tone).toBe("warning");
    // Total: SOL out + fee + rent, and the USDC.
    expect(m.total?.parts).toEqual(["0.00304488 SOL", "5 USDC"]);
  });

  test("a single SOL transfer is the hero, no action list", () => {
    const m = buildSolanaReview({ decoded: tx([multi.instructions[0], multi.instructions[2]]), from: { address: WALLET }, dappName: "x", tokenOf, prices });
    expect(m.actions).toEqual([]);
    expect(m.hero).toMatchObject({ icon: "send", amount: { text: "0.001 SOL" }, counterparty: { prefix: "to" } });
    expect(m.rows.find((r) => r.fullAddress)?.party?.address).toBe("8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR");
    expect(m.hero.usd).toBeCloseTo(0.15);
  });

  test("set authority and unlimited SPL approve are flagged", () => {
    const m = buildSolanaReview({
      decoded: tx([
        ix({ type: "spl_approve", delegate: "DeLeGaTe1111111111111111111111111111111111", mint: MINT, decimals: 6, amount: (2n ** 64n - 1n).toString(), highRisk: true }),
        ix({ type: "spl_set_authority", account: "Acc1", newAuthority: null, highRisk: true }),
      ]),
      from: { address: WALLET }, dappName: "x", tokenOf, prices,
    });
    expect(codes(m)).toEqual(["accountControl", "unlimitedApproval"]);
    expect(m.actions[1]).toMatchObject({ icon: "authority", tone: "danger", detail: { key: "review.action.noAuthority" } });
  });

  test("fee above the cap warns", () => {
    const m = buildSolanaReview({ decoded: { ...tx([multi.instructions[2]]), fee: { ...fee, exceedsCap: true } }, from: { address: WALLET }, dappName: "x", tokenOf, prices });
    expect(codes(m)).toContain("feeCap");
  });
});

describe("TRON", () => {
  const owner = "TOwner111111111111111111111111111";
  const base = { owner, contractAddress: null, unlimited: false, feeLimit: 0n };
  test("TRX transfer", () => {
    const m = buildTronReview({ decoded: { ...base, kind: "trx_transfer", to: "TRecv", amount: 12_500_000n }, from: { address: owner }, feeSun: 0n, prices });
    expect(text(m.hero.amount)).toBe("12.5 TRX");
    expect(m.total).toMatchObject({ native: "12.5 TRX", usd: 2.5 });
  });
  test("TRC-20 unlimited approve shows the fee limit row", () => {
    const m = buildTronReview({ decoded: { ...base, kind: "trc20_approve", to: "TSpender", amount: 2n ** 256n - 1n, contractAddress: "TUsdt", unlimited: true, feeLimit: 100_000_000n }, from: { address: owner }, token: { symbol: "USDT", decimals: 6 }, feeSun: 15_000_000n, prices });
    expect(m.hero.amount).toEqual({ key: "review.unlimited", params: { symbol: "USDT" } });
    expect(codes(m)).toEqual(["unlimitedApproval"]);
    expect(m.rows.find((r) => (r.label as { key: string }).key === "review.fee.limit")?.value).toEqual({ text: "100 TRX" });
  });
  test("unreadable bytes block", () => {
    const m = buildTronReview({ decoded: null, from: { address: owner }, feeSun: 0n, prices });
    expect(m.warnings[0]).toMatchObject({ code: "unreadable", blocks: true });
  });
});

describe("Send flow", () => {
  test("native send uses the form's fiat and sums the total", () => {
    const m = buildSendReview({ asset: { symbol: "ETH", decimals: 18, isNative: true }, amount: "0.25", to: TO, from: FROM, fee: { amount: "0.00042", symbol: "ETH", decimals: 18, usd: 1.36 }, amountUsd: 812.4, prices, firstTimeRecipient: true });
    expect(m.hero).toMatchObject({ amount: { text: "0.25 ETH" }, usd: 812.4 });
    expect(m.total?.native).toBe("0.25042 ETH");
    expect(m.total?.usd).toBeCloseTo(813.76);
    expect(codes(m)).toEqual(["firstTimeRecipient"]);
  });
  test("token send keeps parts apart and shows the memo", () => {
    const m = buildSendReview({ asset: { symbol: "USDC", decimals: 6, isNative: false, contractAddress: USDC }, amount: "10", to: TO, from: FROM, fee: { amount: "0.0001", symbol: "ETH", decimals: 18 }, prices: {}, memo: { labelKey: "send.memo", value: "inv-7" } });
    expect(m.total).toMatchObject({ usd: undefined, parts: ["10 USDC", "0.0001 ETH"] });
    expect(m.rows.at(-1)).toEqual({ label: { key: "send.memo" }, value: { text: "inv-7" } });
  });
});

describe("WalletConnect dispatch", () => {
  const ctx = { from: FROM, dappName: "Uniswap", chainId: 1, nativeSymbol: "ETH", tokenOf: () => undefined, prices, isKnownRecipient: (a: string) => a === TO };
  test("personal_sign hex is decoded to text", () => {
    const hex = "0x" + Buffer.from("Hello kexify").toString("hex");
    expect(buildWcRequestReview("personal_sign", [hex, FROM.address], ctx)?.message).toBe("Hello kexify");
  });
  test("binary personal_sign stays hex", () => {
    expect(buildWcRequestReview("personal_sign", ["0xff00fe", FROM.address], ctx)?.message).toBe("0xff00fe");
  });
  test("first-time warning only for unknown recipients", () => {
    const known = buildWcRequestReview("eth_sendTransaction", [{ to: TO, value: "0x1" }], { ...ctx, feeWei: 1n });
    const unknown = buildWcRequestReview("eth_sendTransaction", [{ to: PERMIT2, value: "0x1" }], { ...ctx, feeWei: 1n });
    expect(known?.warnings).toEqual([]);
    expect(unknown?.warnings.map((w) => w.code)).toEqual(["firstTimeRecipient"]);
  });
  test("TRON unreadable bytes and unknown methods", () => {
    expect(buildWcRequestReview("tron_signTransaction", {}, { ...ctx, tron: { decoded: null, feeSun: 0n } })?.warnings[0].code).toBe("unreadable");
    expect(buildWcRequestReview("wallet_switchEthereumChain", [], ctx)).toBeNull();
  });
});
