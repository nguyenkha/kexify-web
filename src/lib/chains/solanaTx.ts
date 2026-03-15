import { base58 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha256";

// Solana System Program ID (all zeros)
const SYSTEM_PROGRAM_ID = new Uint8Array(32);

// SPL Token Program ID
const TOKEN_PROGRAM_ID = base58.decode("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// Associated Token Account Program ID
const ATA_PROGRAM_ID = base58.decode("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// System Program transfer instruction index
const TRANSFER_IX_INDEX = 2;

// Base fee per signature (5000 lamports)
export const SOLANA_BASE_FEE = 5000n;

function encodeCompactU16(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>= 7;
  }
  bytes.push(v);
  return new Uint8Array(bytes);
}

function writeU64LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return buf;
}

function writeU32LE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = value & 0xff;
  buf[1] = (value >> 8) & 0xff;
  buf[2] = (value >> 16) & 0xff;
  buf[3] = (value >> 24) & 0xff;
  return buf;
}

export interface SolanaTransferParams {
  from: Uint8Array; // 32-byte sender public key
  to: Uint8Array; // 32-byte recipient public key
  lamports: bigint;
  recentBlockhash: string; // base58-encoded blockhash
}

/**
 * Build a Solana System Program transfer message (v0 legacy format).
 * Returns the serialized message bytes ready for signing.
 */
export function buildSolanaTransferMessage(params: SolanaTransferParams): Uint8Array {
  const { from, to, lamports, recentBlockhash } = params;

  // Instruction data: [2, 0, 0, 0] (transfer index as u32 LE) + amount as u64 LE
  const ixData = new Uint8Array(12);
  ixData.set(writeU32LE(TRANSFER_IX_INDEX), 0);
  ixData.set(writeU64LE(lamports), 4);

  // Account keys: [from, to, system_program]
  const accountKeys = [from, to, SYSTEM_PROGRAM_ID];

  // Message header: [num_required_signatures, num_readonly_signed, num_readonly_unsigned]
  // from is signer+writable, to is writable, system_program is readonly
  const header = new Uint8Array([1, 0, 1]);

  // Blockhash bytes
  const blockhashBytes = base58.decode(recentBlockhash);

  // Compiled instruction:
  // - program_id_index: 2 (system program is 3rd account)
  // - accounts: [0, 1] (from, to)
  // - data: ixData
  const compiledIx = new Uint8Array([
    2, // program_id_index
    ...encodeCompactU16(2), // num accounts
    0, 1, // account indices
    ...encodeCompactU16(ixData.length),
    ...ixData,
  ]);

  // Assemble message
  const parts: Uint8Array[] = [
    header,
    encodeCompactU16(accountKeys.length), // num account keys
  ];
  for (const key of accountKeys) {
    parts.push(key);
  }
  parts.push(blockhashBytes);
  parts.push(encodeCompactU16(1)); // num instructions
  parts.push(compiledIx);

  // Concatenate
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const message = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    message.set(part, offset);
    offset += part.length;
  }

  return message;
}

/**
 * Assemble a signed Solana transaction from message + signature.
 * Returns base58-encoded transaction for sendTransaction.
 */
export function assembleSolanaTransaction(
  message: Uint8Array,
  signature: Uint8Array
): string {
  // Transaction format: compact_array(signatures) + message
  const numSigs = encodeCompactU16(1);
  const tx = new Uint8Array(numSigs.length + 64 + message.length);
  tx.set(numSigs, 0);
  tx.set(signature, numSigs.length);
  tx.set(message, numSigs.length + 64);
  return base58.encode(tx);
}

/**
 * Fetch the latest blockhash from a Solana RPC endpoint.
 */
export async function getLatestBlockhash(rpcUrl: string): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "finalized" }],
    }),
  });
  const data = await res.json();
  if (!data.result?.value?.blockhash) {
    throw new Error("Failed to fetch blockhash");
  }
  return data.result.value.blockhash;
}

/**
 * Broadcast a signed Solana transaction.
 * Returns the transaction signature (hash).
 */
export async function broadcastSolanaTransaction(
  rpcUrl: string,
  signedTxBase58: string
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: [signedTxBase58, { encoding: "base58", preflightCommitment: "confirmed" }],
    }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Broadcast failed: ${data.error.message || JSON.stringify(data.error)}`);
  }
  return data.result;
}

/**
 * Poll for Solana transaction confirmation.
 */
export async function waitForSolanaConfirmation(
  rpcUrl: string,
  txSignature: string,
  onAttempt?: (attempt: number) => void,
  maxAttempts = 60,
  intervalMs = 2000
): Promise<{ confirmed: boolean; slot?: number }> {
  for (let i = 1; i <= maxAttempts; i++) {
    onAttempt?.(i);
    await new Promise((r) => setTimeout(r, intervalMs));

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignatureStatuses",
        params: [[txSignature], { searchTransactionHistory: true }],
      }),
    });
    const data = await res.json();
    const status = data.result?.value?.[0];

    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return { confirmed: true, slot: status.slot };
      }
    }
  }
  return { confirmed: false };
}

/**
 * Parse lamports amount to human-readable SOL string.
 */
export function formatLamports(lamports: bigint): string {
  if (lamports === 0n) return "0";
  const str = lamports.toString().padStart(10, "0");
  const intPart = str.slice(0, str.length - 9) || "0";
  const fracPart = str.slice(str.length - 9).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/**
 * Format a token amount with decimals (e.g. 1000000n with 6 decimals → "1").
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (amount === 0n) return "0";
  const str = amount.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

// ── Transaction Decoder ──────────────────────────────────────

function readCompactU16(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  for (;;) {
    const b = buf[offset + bytesRead];
    bytesRead++;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value, bytesRead };
}

function readU32LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

function readU64LE(buf: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value |= BigInt(buf[offset + i]) << BigInt(i * 8);
  }
  return value;
}

const SYSTEM_PROGRAM_B58 = "11111111111111111111111111111111";
const TOKEN_PROGRAM_B58 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// Well-known Solana program labels
export const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "Token Program",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token Program",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token-2022",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter v6",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": "Orca Whirlpool",
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK": "Raydium CLMM",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM",
  "routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS": "Raydium Route",
  "ComputeBudget111111111111111111111111111111": "Compute Budget",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr": "Memo",
  "Memo1UhkJBfCR6MNB6So8FPo3JoRkx7YDXk5WKLXNRh": "Memo (legacy)",
  "srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX": "Serum/OpenBook",
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin": "Serum v3",
  "DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1": "Orca Token Swap",
  "PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY": "Phoenix DEX",
  "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD": "Marinade",
  "Stake11111111111111111111111111111111111111": "Stake Program",
  "Vote111111111111111111111111111111111111111": "Vote Program",
};

export interface DecodedSolanaTx {
  type: "sol_transfer" | "spl_transfer" | "contract_call";
  from: string;
  to?: string;
  amount?: string; // lamports or token smallest unit
  formattedAmount?: string; // human-readable amount
  mint?: string;
  decimals?: number;
  programId?: string;
  programLabel?: string; // human-readable program name
  programs: string[]; // all unique program IDs involved
  numInstructions: number;
  isVersioned: boolean;
}

/**
 * Decode a base64-encoded Solana transaction for display.
 * Extracts the message from wire format and parses instructions.
 */
export function decodeSolanaTransaction(txBase64: string): DecodedSolanaTx {
  const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));

  // Wire format: compact_array(signatures) + message
  const { value: numSigs, bytesRead: sigLenBytes } = readCompactU16(txBytes, 0);
  const messageOffset = sigLenBytes + numSigs * 64;
  const msg = txBytes.slice(messageOffset);

  let offset = 0;
  let isVersioned = false;

  // Detect versioned message (v0)
  if (msg[0] & 0x80) {
    isVersioned = true;
    offset++;
  }

  // Header
  void msg[offset++]; // numRequiredSigs
  void msg[offset++]; // numReadonlySigned
  void msg[offset++]; // numReadonlyUnsigned

  // Account keys
  const { value: numKeys, bytesRead: keysLenBytes } = readCompactU16(msg, offset);
  offset += keysLenBytes;
  const accountKeys: string[] = [];
  for (let i = 0; i < numKeys; i++) {
    accountKeys.push(base58.encode(msg.slice(offset, offset + 32)));
    offset += 32;
  }

  // Skip blockhash
  offset += 32;

  // Instructions
  const { value: numIx, bytesRead: ixLenBytes } = readCompactU16(msg, offset);
  offset += ixLenBytes;

  const from = accountKeys[0] || "unknown";
  let firstProgramId: string | undefined;
  const programSet = new Set<string>();

  // Collect all instructions first, then find the meaningful one
  interface ParsedIx {
    programId: string;
    accountIndices: number[];
    data: Uint8Array;
  }
  const instructions: ParsedIx[] = [];

  for (let i = 0; i < numIx; i++) {
    const programIdIndex = msg[offset++];
    const { value: numAccounts, bytesRead: accLenBytes } = readCompactU16(msg, offset);
    offset += accLenBytes;
    const accountIndices: number[] = [];
    for (let j = 0; j < numAccounts; j++) accountIndices.push(msg[offset++]);
    const { value: dataLen, bytesRead: dataLenBytes } = readCompactU16(msg, offset);
    offset += dataLenBytes;
    const data = msg.slice(offset, offset + dataLen);
    offset += dataLen;

    const programId = accountKeys[programIdIndex] || "";
    if (i === 0) firstProgramId = programId;
    if (programId) programSet.add(programId);
    instructions.push({ programId, accountIndices, data });
  }

  const programs = [...programSet];

  // Programs that are just plumbing — if ALL programs are basic, it's a transfer;
  // if any non-basic program is present, it's a contract_call (swap, stake, etc.)
  const BASIC_PROGRAMS = new Set([
    SYSTEM_PROGRAM_B58,
    TOKEN_PROGRAM_B58,
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
    "ComputeBudget111111111111111111111111111111",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    "Memo1UhkJBfCR6MNB6So8FPo3JoRkx7YDXk5WKLXNRh",
  ]);
  const hasDeFiProgram = programs.some((p) => !BASIC_PROGRAMS.has(p));

  // Only look for transfers if no DeFi program is involved
  // (otherwise a tiny rent transfer inside a swap would be misidentified)
  if (!hasDeFiProgram) for (const ix of instructions) {
    const { programId, accountIndices: accs, data } = ix;

    // SOL transfer: System Program, 12 bytes data, instruction index = 2
    if (programId === SYSTEM_PROGRAM_B58 && data.length === 12) {
      const ixIndex = readU32LE(data, 0);
      if (ixIndex === 2) {
        const lamports = readU64LE(data, 4);
        return {
          type: "sol_transfer",
          from,
          to: accountKeys[accs[1]] || "unknown",
          amount: lamports.toString(),
          formattedAmount: formatLamports(lamports),
          programs,
          numInstructions: numIx,
          isVersioned,
        };
      }
    }

    // SPL Token TransferChecked: data[0] = 12, 10 bytes
    // Accounts: [source, mint, dest, owner]
    if (programId === TOKEN_PROGRAM_B58 && data.length === 10 && data[0] === 12) {
      const amount = readU64LE(data, 1);
      const decimals = data[9];
      return {
        type: "spl_transfer",
        from: accountKeys[accs[3]] || from,
        to: accountKeys[accs[2]] || "unknown",
        amount: amount.toString(),
        formattedAmount: formatTokenAmount(amount, decimals),
        mint: accountKeys[accs[1]] || "unknown",
        decimals,
        programs,
        numInstructions: numIx,
        isVersioned,
      };
    }

    // SPL Token Transfer (legacy, ix 3): data[0] = 3, 9 bytes (u64 amount)
    // Accounts: [source, dest, owner]
    if (programId === TOKEN_PROGRAM_B58 && data.length === 9 && data[0] === 3) {
      const amount = readU64LE(data, 1);
      return {
        type: "spl_transfer",
        from: accountKeys[accs[2]] || from,
        to: accountKeys[accs[1]] || "unknown",
        amount: amount.toString(),
        programs,
        numInstructions: numIx,
        isVersioned,
      };
    }

    // Token-2022 TransferChecked: same format as Token Program
    if (programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" && data.length === 10 && data[0] === 12) {
      const amount = readU64LE(data, 1);
      const decimals = data[9];
      return {
        type: "spl_transfer",
        from: accountKeys[accs[3]] || from,
        to: accountKeys[accs[2]] || "unknown",
        amount: amount.toString(),
        formattedAmount: formatTokenAmount(amount, decimals),
        mint: accountKeys[accs[1]] || "unknown",
        decimals,
        programs,
        numInstructions: numIx,
        isVersioned,
      };
    }
  }

  // No transfer found — identify the main program (skip plumbing)
  const SKIP_PROGRAMS = BASIC_PROGRAMS;
  const mainProgram = programs.find((p) => !SKIP_PROGRAMS.has(p)) || firstProgramId;

  return {
    type: "contract_call",
    from,
    programId: mainProgram,
    programLabel: mainProgram ? KNOWN_PROGRAMS[mainProgram] : undefined,
    programs,
    numInstructions: numIx,
    isVersioned,
  };
}

// ── SPL Token Support ──────────────────────────────────────────

/**
 * Derive the Associated Token Account (ATA) address for a given owner + mint.
 * Seeds: [owner, token_program_id, mint] under ATA program.
 */
export function findAssociatedTokenAddress(
  owner: Uint8Array,
  mint: Uint8Array
): Uint8Array {
  // PDA = SHA256(seeds || program_id || "ProgramDerivedAddress")
  // Must skip nonces that produce on-curve ed25519 points
  for (let nonce = 255; nonce >= 0; nonce--) {
    const hash = sha256(
      concatBytes(owner, TOKEN_PROGRAM_ID, mint, new Uint8Array([nonce]), ATA_PROGRAM_ID, new TextEncoder().encode("ProgramDerivedAddress"))
    );
    if (!isOnEd25519Curve(hash)) return new Uint8Array(hash);
  }
  throw new Error("Could not find PDA");
}

/** Check if 32 bytes represent a valid ed25519 point (on-curve). */
function isOnEd25519Curve(bytes: Uint8Array): boolean {
  const p = 2n ** 255n - 19n;
  // Decode y from little-endian, clear sign bit
  let y = 0n;
  for (let i = 0; i < 32; i++) y |= BigInt(bytes[i]) << BigInt(8 * i);
  y &= (1n << 255n) - 1n;
  if (y >= p) return false;
  // x^2 = (y^2 - 1) / (d*y^2 + 1) mod p
  const d = (p - 121665n * modPow(121666n, p - 2n, p) % p + p) % p;
  const y2 = y * y % p;
  const x2 = (y2 - 1n + p) % p * modPow((d * y2 % p + 1n) % p, p - 2n, p) % p;
  // Euler's criterion: x2 is a quadratic residue iff x2^((p-1)/2) ≡ 0 or 1 (mod p)
  const e = modPow(x2, (p - 1n) / 2n, p);
  return e === 1n || e === 0n;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) r = r * base % mod;
    exp >>= 1n;
    base = base * base % mod;
  }
  return r;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

/**
 * Check if an ATA exists on-chain.
 */
export async function checkAtaExists(
  rpcUrl: string,
  ataAddress: string
): Promise<boolean> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [ataAddress, { encoding: "base64" }],
    }),
  });
  const data = await res.json();
  return data.result?.value !== null;
}

export interface SplTransferParams {
  from: Uint8Array;        // 32-byte sender public key
  to: Uint8Array;          // 32-byte recipient public key
  mint: Uint8Array;        // 32-byte SPL token mint
  amount: bigint;          // token amount in smallest unit
  decimals: number;        // token decimals (for TransferChecked)
  recentBlockhash: string;
  createAta: boolean;      // whether to include create ATA instruction
}

/**
 * Build a Solana SPL Token TransferChecked message.
 * Optionally includes a create ATA instruction for the recipient.
 */
export function buildSplTransferMessage(params: SplTransferParams): Uint8Array {
  const { from, to, mint, amount, decimals, recentBlockhash, createAta } = params;

  const sourceAta = findAssociatedTokenAddress(from, mint);
  const destAta = findAssociatedTokenAddress(to, mint);

  // Build account keys list and instructions
  const instructions: Uint8Array[] = [];

  if (createAta) {
    // Account keys order:
    // 0: from (signer, writable) - payer
    // 1: destAta (writable)
    // 2: to (recipient owner)
    // 3: mint
    // 4: system_program
    // 5: token_program
    // 6: ata_program
    // 7: sourceAta (writable)

    void [from, destAta, to, mint, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, ATA_PROGRAM_ID, sourceAta]; // accountKeys

    // Header: 1 signer (from), 0 readonly signed, 3 readonly unsigned (mint, system, token_program... wait)
    // Let me think about this more carefully.
    // Accounts:
    // 0: from        - signer, writable
    // 1: destAta     - writable (not signer)
    // 2: to          - readonly (not signer)
    // 3: mint        - readonly (not signer)
    // 4: system      - readonly (not signer)
    // 5: token_prog  - readonly (not signer)
    // 6: ata_prog    - readonly (not signer)
    // 7: sourceAta   - writable (not signer)
    //
    // Solana ordering: signers+writable first, then signers+readonly, then non-signers+writable, then non-signers+readonly
    // Reorder: [from(sw)] [<none s-ro>] [destAta(w), sourceAta(w)] [to(ro), mint(ro), system(ro), token(ro), ata(ro)]
    // = [from, destAta, sourceAta, to, mint, system_program, token_program, ata_program]
    // num_required_signatures = 1, num_readonly_signed = 0, num_readonly_unsigned = 5

    const orderedKeys = [from, destAta, sourceAta, to, mint, SYSTEM_PROGRAM_ID, TOKEN_PROGRAM_ID, ATA_PROGRAM_ID];
    // Indices in orderedKeys:
    // from=0, destAta=1, sourceAta=2, to=3, mint=4, system=5, token=6, ata=7
    const header = new Uint8Array([1, 0, 5]); // 1 signer, 0 readonly-signed, 5 readonly-unsigned

    // Create ATA instruction: program=ata(7), accounts=[0(from/payer), 1(destAta), 3(to/owner), 4(mint), 5(system), 6(token)]
    const createAtaIx = new Uint8Array([
      7, // program_id_index (ata_program)
      ...encodeCompactU16(6), // 6 accounts
      0, 1, 3, 4, 5, 6, // payer, ata, owner, mint, system_program, token_program
      ...encodeCompactU16(0), // no instruction data
    ]);

    // TransferChecked instruction: program=token(6), accounts=[2(sourceAta), 4(mint), 1(destAta), 0(from/owner)]
    // Data: [12 (instruction index), amount as u64 LE, decimals as u8]
    const transferData = new Uint8Array(10);
    transferData[0] = 12; // TransferChecked index
    transferData.set(writeU64LE(amount), 1);
    transferData[9] = decimals;

    const transferIx = new Uint8Array([
      6, // program_id_index (token_program)
      ...encodeCompactU16(4), // 4 accounts
      2, 4, 1, 0, // source_ata, mint, dest_ata, owner
      ...encodeCompactU16(transferData.length),
      ...transferData,
    ]);

    instructions.push(createAtaIx);
    instructions.push(transferIx);

    const blockhashBytes = base58.decode(recentBlockhash);
    const parts: Uint8Array[] = [
      header,
      encodeCompactU16(orderedKeys.length),
    ];
    for (const key of orderedKeys) parts.push(key);
    parts.push(blockhashBytes);
    parts.push(encodeCompactU16(instructions.length));
    for (const ix of instructions) parts.push(ix);

    return concatAllParts(parts);
  } else {
    // No create ATA — simpler account layout
    // Accounts:
    // 0: from       - signer, writable (owner of source ATA)
    // 1: sourceAta  - writable
    // 2: destAta    - writable
    // 3: mint       - readonly
    // 4: token_prog - readonly
    //
    // Header: 1 signer, 0 readonly-signed, 2 readonly-unsigned
    const orderedKeys = [from, sourceAta, destAta, mint, TOKEN_PROGRAM_ID];
    const header = new Uint8Array([1, 0, 2]);

    // TransferChecked: program=token(4), accounts=[1(source), 3(mint), 2(dest), 0(owner)]
    const transferData = new Uint8Array(10);
    transferData[0] = 12;
    transferData.set(writeU64LE(amount), 1);
    transferData[9] = decimals;

    const transferIx = new Uint8Array([
      4, // program_id_index (token_program)
      ...encodeCompactU16(4),
      1, 3, 2, 0, // source_ata, mint, dest_ata, owner
      ...encodeCompactU16(transferData.length),
      ...transferData,
    ]);

    const blockhashBytes = base58.decode(recentBlockhash);
    const parts: Uint8Array[] = [
      header,
      encodeCompactU16(orderedKeys.length),
    ];
    for (const key of orderedKeys) parts.push(key);
    parts.push(blockhashBytes);
    parts.push(encodeCompactU16(1));
    parts.push(transferIx);

    return concatAllParts(parts);
  }
}

function concatAllParts(parts: Uint8Array[]): Uint8Array {
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const message = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    message.set(part, offset);
    offset += part.length;
  }
  return message;
}
