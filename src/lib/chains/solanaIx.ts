import { base58 } from "@scure/base";

// Per-instruction Solana decoding + fee estimate for approval screens. Pure (no network, no DOM) so the
// iOS JSC bundle runs the same code as the web. Mirrors what the API policy sees (api/src/policy/solana-intent.ts):
// every instruction is listed, nothing is skipped.

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
// Same two ids as the API policy: any other program is not a memo.
const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"]);

/** Fee payer pays this per required signature. */
export const SOLANA_BASE_FEE = 5000n;
/** Runtime default compute budget per (non compute-budget) instruction, and the hard per-tx limit. */
export const DEFAULT_CU_PER_IX = 200_000n;
export const MAX_COMPUTE_UNITS = 1_400_000n;
/** Rent an ATA create funds (upper bound, same as the API policy). */
export const ATA_RENT_UPPER_BOUND = 2_100_000n;
/** Server fee cap (api/src/policy/fee-caps.ts, 0.05 SOL): a transaction above it is rejected at co-sign. */
export const SOLANA_FEE_CAP_LAMPORTS = 50_000_000n;

export function formatLamports(lamports: bigint): string {
  if (lamports === 0n) return "0";
  const str = lamports.toString().padStart(10, "0");
  const intPart = str.slice(0, str.length - 9) || "0";
  const fracPart = str.slice(str.length - 9).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return "0";
  const str = amount.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export interface RawSolanaIx {
  programId: string; // "" when the program index is outside the static keys
  accounts: (string | null)[]; // null = account index outside the static keys (address lookup table)
  data: Uint8Array;
}

export type SolanaIxType =
  | "sol_transfer" // from/to/amount: System Transfer, TransferWithSeed, CreateAccount(+WithSeed) funding, nonce withdraw
  | "spl_transfer" // from = owner, to = destination token account (destOwner if created in this tx)
  | "spl_approve" // delegate may spend `amount` from `account`
  | "spl_set_authority"
  | "spl_close_account"
  | "spl_other" // other token instruction (mint/burn/freeze/extension ...)
  | "account_control" // System assign / authorize nonce
  | "ata_create"
  | "compute_budget"
  | "memo"
  | "program" // a program we do not decode; programLabel set when known
  | "unknown"; // malformed or undecodable instruction of a program we do decode

export interface DecodedSolanaIx {
  type: SolanaIxType;
  programId: string;
  programLabel?: string;
  /** Short machine name for the operation, e.g. "transferChecked", "setComputeUnitPrice". */
  op?: string;
  from?: string;
  to?: string;
  destOwner?: string; // owner of `to` when an ATA create in the same tx names it
  amount?: string; // lamports / token base units
  formattedAmount?: string;
  mint?: string;
  decimals?: number;
  delegate?: string;
  account?: string;
  newAuthority?: string | null;
  authorityType?: number;
  memo?: string;
  computeUnitLimit?: number;
  computeUnitPrice?: string; // micro-lamports per CU
  detail?: string; // why `unknown`
  /** Approvals, authority changes, foreign account closes and everything undecoded: warn on the approval screen. */
  highRisk: boolean;
}

export interface SolanaFeeEstimate {
  baseLamports: string;
  /** Priority fee at the compute-unit limit the tx asks for (or the runtime default when it sets none). */
  priorityLamports: string;
  /** Rent funded by ATA creates in this tx (upper bound), paid from the fee payer. */
  rentLamports: string;
  /** base + priority: the network fee the approval screen shows. */
  totalLamports: string;
  /** base + priority + rent: everything the fee payer loses (balance preview). */
  costLamports: string;
  /** What the API policy compares with the fee cap: priority uses 1.4M CU when the tx sets no limit. */
  policyLamports: string;
  capLamports: string;
  exceedsCap: boolean;
  computeUnitLimit: number | null;
  computeUnitPrice: string;
}

const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
function u64(d: Uint8Array, o: number): bigint {
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(d[o + i]);
  return n;
}

// Tokens: instructions that move no value and change no authority.
const TOKEN_NOOPS = new Set([0, 1, 2, 5, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
const TOKEN_OP_NAMES: Record<number, string> = { 7: "mintTo", 8: "burn", 10: "freezeAccount", 11: "thawAccount", 14: "mintToChecked", 15: "burnChecked" };

export function decodeSolanaInstructions(ixs: RawSolanaIx[], labels: Record<string, string>, feePayer: string): DecodedSolanaIx[] {
  const out: DecodedSolanaIx[] = [];
  const ataOwners = new Map<string, string>(); // ATA created in this tx -> owner

  for (const ix of ixs) {
    const { programId, accounts: a, data: d } = ix;
    const label = labels[programId];
    const base = { programId, programLabel: label };
    const unknown = (detail: string): DecodedSolanaIx => ({ ...base, type: "unknown", detail, highRisk: true });
    const program = (): DecodedSolanaIx => ({ ...base, type: "program", highRisk: true });

    if (!programId) { out.push(unknown("program id outside the static account keys")); continue; }
    const decoded = programId === SYSTEM_PROGRAM || programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM || programId === ATA_PROGRAM;
    // Lookup-table accounts are not in the signed bytes: a decoded program cannot say where value goes.
    if (decoded && a.some((k) => k === null)) { out.push(unknown("account from an address lookup table")); continue; }

    if (programId === SYSTEM_PROGRAM) {
      const op = d.length >= 4 ? u32(d, 0) : -1;
      if (op === 2 && d.length === 12 && a[0] && a[1]) {
        out.push({ ...base, type: "sol_transfer", op: "transfer", from: a[0]!, to: a[1]!, amount: u64(d, 4).toString(), formattedAmount: formatLamports(u64(d, 4)), highRisk: false });
      } else if (op === 11 && d.length >= 12 && a[0] && a[2]) {
        out.push({ ...base, type: "sol_transfer", op: "transferWithSeed", from: a[0]!, to: a[2]!, amount: u64(d, 4).toString(), formattedAmount: formatLamports(u64(d, 4)), highRisk: false });
      } else if (op === 0 && d.length === 52 && a[0] && a[1]) {
        out.push({ ...base, type: "sol_transfer", op: "createAccount", from: a[0]!, to: a[1]!, amount: u64(d, 4).toString(), formattedAmount: formatLamports(u64(d, 4)), highRisk: false });
      } else if (op === 3 && d.length >= 44 && a[0] && a[1]) {
        const seedLen = Number(u64(d, 36));
        if (d.length !== 44 + seedLen + 48) { out.push(unknown("malformed CreateAccountWithSeed instruction")); continue; }
        const lamports = u64(d, 44 + seedLen);
        out.push({ ...base, type: "sol_transfer", op: "createAccountWithSeed", from: a[0]!, to: a[1]!, amount: lamports.toString(), formattedAmount: formatLamports(lamports), highRisk: false });
      } else if (op === 5 && d.length === 12 && a[0] && a[1]) { // WithdrawNonceAccount [nonce, to, ...]
        out.push({ ...base, type: "sol_transfer", op: "withdrawNonce", from: a[0]!, to: a[1]!, amount: u64(d, 4).toString(), formattedAmount: formatLamports(u64(d, 4)), highRisk: false });
      } else if (op === 1 || op === 10 || op === 7) {
        out.push({ ...base, type: "account_control", op: op === 1 ? "assign" : op === 10 ? "assignWithSeed" : "authorizeNonce", account: a[0] ?? undefined, highRisk: true });
      } else if (op === 4 || op === 6 || op === 12) {
        out.push({ ...base, type: "program", op: op === 4 ? "advanceNonce" : op === 6 ? "initializeNonce" : "upgradeNonce", highRisk: false });
      } else {
        out.push(unknown(`system instruction ${op}`));
      }
      continue;
    }

    if (programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM) {
      const op = d.length > 0 ? d[0] : -1;
      if (op === 3 && d.length === 9 && a[0] && a[1] && a[2]) { // Transfer [src, dst, owner]: mint not in the bytes
        out.push({ ...base, type: "spl_transfer", op: "transfer", account: a[0]!, from: a[2]!, to: a[1]!, amount: u64(d, 1).toString(), highRisk: false });
      } else if (op === 12 && d.length === 10 && a[0] && a[1] && a[2] && a[3]) { // TransferChecked [src, mint, dst, owner]
        const amount = u64(d, 1);
        out.push({ ...base, type: "spl_transfer", op: "transferChecked", account: a[0]!, mint: a[1]!, to: a[2]!, from: a[3]!, amount: amount.toString(), decimals: d[9], formattedAmount: formatTokenAmount(amount, d[9]), highRisk: false });
      } else if (op === 4 && d.length === 9 && a[0] && a[1]) { // Approve [src, delegate, owner]
        out.push({ ...base, type: "spl_approve", op: "approve", account: a[0]!, delegate: a[1]!, from: a[2] ?? undefined, amount: u64(d, 1).toString(), highRisk: true });
      } else if (op === 13 && d.length === 10 && a[0] && a[1] && a[2]) { // ApproveChecked [src, mint, delegate, owner]
        const amount = u64(d, 1);
        out.push({ ...base, type: "spl_approve", op: "approveChecked", account: a[0]!, mint: a[1]!, delegate: a[2]!, from: a[3] ?? undefined, amount: amount.toString(), decimals: d[9], formattedAmount: formatTokenAmount(amount, d[9]), highRisk: true });
      } else if (op === 6 && d.length >= 3 && a[0]) { // SetAuthority [account, current authority]; data = 6, type, option, [32]
        const hasNew = d[2] === 1 && d.length >= 35;
        out.push({ ...base, type: "spl_set_authority", op: "setAuthority", account: a[0]!, authorityType: d[1], newAuthority: hasNew ? base58.encode(d.slice(3, 35)) : null, highRisk: true });
      } else if (op === 9 && a[0] && a[1]) { // CloseAccount [account, destination, owner]
        out.push({ ...base, type: "spl_close_account", op: "closeAccount", account: a[0]!, to: a[1]!, from: a[2] ?? undefined, highRisk: a[1] !== feePayer });
      } else if (TOKEN_NOOPS.has(op)) {
        out.push({ ...base, type: "spl_other", op: `token_${op}`, highRisk: false });
      } else if (op in TOKEN_OP_NAMES) {
        out.push({ ...base, type: "spl_other", op: TOKEN_OP_NAMES[op], account: a[0] ?? undefined, highRisk: true });
      } else {
        out.push(unknown(`token instruction ${op}`));
      }
      continue;
    }

    if (programId === COMPUTE_BUDGET_PROGRAM) {
      if (d[0] === 2 && d.length === 5) out.push({ ...base, type: "compute_budget", op: "setComputeUnitLimit", computeUnitLimit: u32(d, 1), highRisk: false });
      else if (d[0] === 3 && d.length === 9) out.push({ ...base, type: "compute_budget", op: "setComputeUnitPrice", computeUnitPrice: u64(d, 1).toString(), highRisk: false });
      else if (d[0] === 1 && d.length === 5) out.push({ ...base, type: "compute_budget", op: "requestHeapFrame", highRisk: false });
      else if (d[0] === 4 && d.length === 5) out.push({ ...base, type: "compute_budget", op: "setLoadedAccountsDataSizeLimit", highRisk: false });
      else out.push(unknown("malformed ComputeBudget instruction"));
      continue;
    }

    if (programId === ATA_PROGRAM) {
      // Create (0 / empty) and CreateIdempotent (1) [payer, ata, owner, mint, ...]
      if ((d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1))) && a[1] && a[2] && a[3]) {
        ataOwners.set(a[1]!, a[2]!);
        out.push({ ...base, type: "ata_create", op: d[0] === 1 ? "createIdempotent" : "create", from: a[0] ?? undefined, to: a[1]!, destOwner: a[2]!, mint: a[3]!, highRisk: false });
      } else {
        out.push(unknown("associated-token instruction"));
      }
      continue;
    }

    if (MEMO_PROGRAMS.has(programId)) {
      out.push({ ...base, type: "memo", memo: new TextDecoder().decode(d), highRisk: false });
      continue;
    }

    out.push(program());
  }

  for (const ix of out) {
    if (ix.type === "spl_transfer" && ix.to && ataOwners.has(ix.to)) ix.destOwner = ataOwners.get(ix.to);
  }
  return out;
}

/** Network fee of the message: base per signature + priority (price x CU limit) + ATA rent. Same maths as the API policy. */
export function estimateSolanaFee(ixs: DecodedSolanaIx[], numRequiredSignatures: number): SolanaFeeEstimate {
  let price = 0n;
  let limit: bigint | null = null;
  let rent = 0n;
  let nonBudget = 0n;
  for (const ix of ixs) {
    if (ix.type === "compute_budget") {
      if (ix.op === "setComputeUnitPrice") price = BigInt(ix.computeUnitPrice ?? "0");
      else if (ix.op === "setComputeUnitLimit") limit = BigInt(ix.computeUnitLimit ?? 0);
    } else {
      nonBudget++;
      if (ix.type === "ata_create") rent += ATA_RENT_UPPER_BOUND;
    }
  }
  const ceilDiv = (n: bigint) => (n + 999_999n) / 1_000_000n;
  const clamp = (n: bigint) => (n > MAX_COMPUTE_UNITS ? MAX_COMPUTE_UNITS : n);
  const effLimit = clamp(limit ?? DEFAULT_CU_PER_IX * nonBudget);
  const base = SOLANA_BASE_FEE * BigInt(numRequiredSignatures);
  const priority = ceilDiv(price * effLimit);
  const policy = base + ceilDiv(price * clamp(limit ?? MAX_COMPUTE_UNITS)) + rent;
  return {
    baseLamports: base.toString(),
    priorityLamports: priority.toString(),
    rentLamports: rent.toString(),
    totalLamports: (base + priority).toString(),
    costLamports: (base + priority + rent).toString(),
    policyLamports: policy.toString(),
    capLamports: SOLANA_FEE_CAP_LAMPORTS.toString(),
    exceedsCap: policy > SOLANA_FEE_CAP_LAMPORTS,
    computeUnitLimit: limit === null ? null : Number(limit),
    computeUnitPrice: price.toString(),
  };
}

/** Lamports leaving the account through System transfers/creates in the message (before fees). */
export function solanaSolOutflow(ixs: DecodedSolanaIx[]): bigint {
  return ixs.reduce((sum, ix) => (ix.type === "sol_transfer" && ix.amount ? sum + BigInt(ix.amount) : sum), 0n);
}
