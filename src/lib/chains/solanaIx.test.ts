import { describe, expect, test } from "bun:test";
import { base58 } from "@scure/base";
import { decodeSolanaTransaction } from "./solanaTx";
import { ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./solanaIx";

const key = (n: number) => base58.encode(new Uint8Array(32).fill(n));
const PAYER = key(1), DEST = key(2), MINT = key(3), SRC_ATA = key(4), DST_ATA = key(5), DELEGATE = key(6), NEW_AUTH = key(7), UNKNOWN_PROG = key(9);

const le = (v: bigint, bytes: number) => Array.from({ length: bytes }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
type Ix = { program: string; accounts: string[]; data: number[] };

/** Legacy message wrapped as a wire tx (one empty signature slot), base64. */
function wire(ixs: Ix[], numSigs = 1): string {
  const keys: string[] = [PAYER];
  const add = (k: string) => { if (!keys.includes(k)) keys.push(k); };
  for (const ix of ixs) { ix.accounts.forEach(add); add(ix.program); }
  const msg: number[] = [numSigs, 0, 1, keys.length];
  keys.forEach((k) => msg.push(...base58.decode(k)));
  msg.push(...new Array(32).fill(7), ixs.length);
  for (const ix of ixs) msg.push(keys.indexOf(ix.program), ix.accounts.length, ...ix.accounts.map((a) => keys.indexOf(a)), ix.data.length, ...ix.data);
  const bytes = new Uint8Array([1, ...new Array(64).fill(0), ...msg]);
  return btoa(String.fromCharCode(...bytes));
}

const transfer = (to: string, lamports: bigint): Ix => ({ program: SYSTEM_PROGRAM, accounts: [PAYER, to], data: [2, 0, 0, 0, ...le(lamports, 8)] });
const checked = (amount: bigint, dec: number): Ix => ({ program: TOKEN_PROGRAM, accounts: [SRC_ATA, MINT, DST_ATA, PAYER], data: [12, ...le(amount, 8), dec] });
const price = (microLamports: bigint): Ix => ({ program: COMPUTE_BUDGET_PROGRAM, accounts: [], data: [3, ...le(microLamports, 8)] });
const limit = (cu: number): Ix => ({ program: COMPUTE_BUDGET_PROGRAM, accounts: [], data: [2, ...le(BigInt(cu), 4)] });

describe("decodeSolanaTransaction lists every instruction", () => {
  test("multi-transfer: both SOL transfers are listed", () => {
    const d = decodeSolanaTransaction(wire([transfer(DEST, 1_000_000_000n), transfer(key(8), 250_000_000n)]));
    expect(d.instructions.map((i) => [i.type, i.to, i.formattedAmount])).toEqual([
      ["sol_transfer", DEST, "1"],
      ["sol_transfer", key(8), "0.25"],
    ]);
    expect(d.instructions.every((i) => !i.highRisk)).toBe(true);
  });

  test("SPL transferChecked: owner, destination token account, mint, decimals", () => {
    const [ix] = decodeSolanaTransaction(wire([checked(1_500_000n, 6)])).instructions;
    expect(ix).toMatchObject({ type: "spl_transfer", op: "transferChecked", from: PAYER, to: DST_ATA, mint: MINT, decimals: 6, amount: "1500000", formattedAmount: "1.5" });
  });

  test("ATA create in the same tx names the destination owner", () => {
    const create: Ix = { program: ATA_PROGRAM, accounts: [PAYER, DST_ATA, DEST, MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM], data: [1] };
    const d = decodeSolanaTransaction(wire([create, checked(5n, 0)]));
    expect(d.instructions[0]).toMatchObject({ type: "ata_create", destOwner: DEST, mint: MINT });
    expect(d.instructions[1]).toMatchObject({ type: "spl_transfer", destOwner: DEST });
    expect(d.fee.rentLamports).toBe("2100000");
    expect(d.fee.totalLamports).toBe("5000"); // rent is not part of the network fee
    expect(d.fee.costLamports).toBe("2105000");
  });

  test("approve, setAuthority and foreign closeAccount are high risk", () => {
    const approve: Ix = { program: TOKEN_PROGRAM, accounts: [SRC_ATA, DELEGATE, PAYER], data: [4, ...le(42n, 8)] };
    const setAuth: Ix = { program: TOKEN_PROGRAM, accounts: [SRC_ATA, PAYER], data: [6, 2, 1, ...base58.decode(NEW_AUTH)] };
    const close: Ix = { program: TOKEN_PROGRAM, accounts: [SRC_ATA, DEST, PAYER], data: [9] };
    const closeSelf: Ix = { program: TOKEN_PROGRAM, accounts: [SRC_ATA, PAYER, PAYER], data: [9] };
    const [a, s, c, cs] = decodeSolanaTransaction(wire([approve, setAuth, close, closeSelf])).instructions;
    expect(a).toMatchObject({ type: "spl_approve", delegate: DELEGATE, amount: "42", highRisk: true });
    expect(s).toMatchObject({ type: "spl_set_authority", authorityType: 2, newAuthority: NEW_AUTH, highRisk: true });
    expect(c).toMatchObject({ type: "spl_close_account", to: DEST, highRisk: true });
    expect(cs.highRisk).toBe(false);
  });

  test("unknown program is listed with its id and stays high risk", () => {
    const d = decodeSolanaTransaction(wire([transfer(DEST, 1n), { program: UNKNOWN_PROG, accounts: [DEST], data: [1, 2, 3] }]));
    expect(d.instructions[1]).toMatchObject({ type: "program", programId: UNKNOWN_PROG, highRisk: true });
    expect(d.instructions[1].programLabel).toBeUndefined();
    expect(d.numInstructions).toBe(2);
  });

  test("token instruction we do not decode is unknown + high risk", () => {
    const burn: Ix = { program: TOKEN_PROGRAM, accounts: [SRC_ATA, MINT, PAYER], data: [8, ...le(1n, 8)] };
    expect(decodeSolanaTransaction(wire([burn])).instructions[0]).toMatchObject({ type: "spl_other", op: "burn", highRisk: true });
    const weird: Ix = { program: TOKEN_PROGRAM, accounts: [SRC_ATA], data: [99] };
    expect(decodeSolanaTransaction(wire([weird])).instructions[0]).toMatchObject({ type: "unknown", highRisk: true });
  });
});

describe("solana fee estimate", () => {
  test("no compute budget: base fee only", () => {
    const f = decodeSolanaTransaction(wire([transfer(DEST, 1n)])).fee;
    expect(f).toMatchObject({ baseLamports: "5000", priorityLamports: "0", totalLamports: "5000", exceedsCap: false });
  });

  test("price x explicit limit, rounded up", () => {
    // 1_000 micro-lamports/CU x 300_000 CU = 300 lamports
    const f = decodeSolanaTransaction(wire([limit(300_000), price(1_000n), transfer(DEST, 1n)])).fee;
    expect(f).toMatchObject({ priorityLamports: "300", totalLamports: "5300", computeUnitLimit: 300_000, computeUnitPrice: "1000" });
    // 1 micro-lamport x 1 CU -> ceil to 1 lamport
    expect(decodeSolanaTransaction(wire([limit(1), price(1n), transfer(DEST, 1n)])).fee.priorityLamports).toBe("1");
  });

  test("no limit: 200k CU per instruction for the estimate, 1.4M for the policy bound", () => {
    const f = decodeSolanaTransaction(wire([price(1_000_000n), transfer(DEST, 1n), transfer(key(8), 1n)])).fee;
    expect(f.priorityLamports).toBe("400000"); // 1 lamport/CU x 2 ix x 200k
    expect(f.policyLamports).toBe(String(5000 + 1_400_000));
  });

  test("policy bound above 0.05 SOL is flagged", () => {
    const f = decodeSolanaTransaction(wire([limit(1_400_000), price(50_000_000n), transfer(DEST, 1n)])).fee;
    expect(f.priorityLamports).toBe("70000000");
    expect(f.exceedsCap).toBe(true);
  });

  test("legacy memo id that the API does not treat as a memo is a program call", () => {
    const fake = "Memo1UhkJBfCR6MNB6So8FPo3JoRkx7YDXk5WKLXNRh";
    const [ix] = decodeSolanaTransaction(wire([{ program: fake, accounts: [], data: [104, 105] }])).instructions;
    expect(ix).toMatchObject({ type: "program", highRisk: true });
  });

  test("base fee scales with required signatures", () => {
    expect(decodeSolanaTransaction(wire([transfer(DEST, 1n)], 2)).fee.baseLamports).toBe("10000");
  });
});
