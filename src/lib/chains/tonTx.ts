/**
 * TON transaction building and broadcasting for MPC signing flow.
 * Uses @ton/core for BOC serialization (wallet v4r2 contract).
 */

import { beginCell, Cell, Address, SendMode, storeMessageRelaxed, internal, toNano } from "@ton/core";
import { hexToBytes } from "../../shared/utils";

// ── Wallet V4R2 constants (same as in tonAdapter.ts) ────────────

const WALLET_V4R2_CODE = Cell.fromBoc(
  Buffer.from(
    "te6cckECFAEAAtQAART/APSkE/S88sgLAQIBIAIPAgFIAwYC5tAB0NMDIXGwkl8E4CLXScEgkl8E4ALTHyGCEHBsdWe9IoIQZHN0cr2wkl8F4AP6QDAg+kQByMoHy//J0O1E0IEBQNch9AQwXIEBCPQKb6Exs5JfB+AF0z/IJYIQcGx1Z7qSODDjDQOCEGRzdHK6kl8G4w0EBQB4AfoA9AQw+CdvIjBQCqEhvvLgUIIQcGx1Z4MesXCAGFAEywUmzxZY+gIZ9ADLaRfLH1Jgyz8gyYBA+wAGAIpQBIEBCPRZMO1E0IEBQNcgyAHPFvQAye1UAXKwjiOCEGRzdHKDHrFwgBhQBcsFUAPPFiP6AhPLassfyz/JgED7AJJfA+ICASAHDgIBIAgNAgFYCQoAPbKd+1E0IEBQNch9AQwAsjKB8v/ydABgQEI9ApvoTGACASALDAAZrc52omhAIGuQ64X/wAAZrx32omhAEGuQ64WPwAARuMl+1E0NcLH4AFm9JCtvaiaECAoGuQ+gIYRw1AgIR6STfSmRDOaQPp/5g3gSgBt4EBSJhxWfMYQE+PKDCNcYINMf0x/THwL4I7vyZO1E0NMf0x/T//QE0VFDuvKhUVG68qIF+QFUEGT5EPKj+AAkpMjLH1JAyx9SMMv/UhD0AMntVPgPAdMHIcAAn2xRkyDXSpbTB9QC+wDoMOAhwAHjACHAAuMAAcADkTDjDQOkyMsfEssfy/8QERITAG7SB/oA1NQi+QAFyMoHFcv/ydB3dIAYyMsFywIizxZQBfoCFMtrEszMyXP7AMhAFIEBCPRR8qcCAHCBAQjXGPoA0z/IVCBHgQEI9FHyp4IQbm90ZXB0gBjIywXLAlAGzxZQBPoCFMtqEssfyz/Jc/sAAgBsgQEI1xj6ANM/MFIkgQEI9Fnyp4IQZHN0cnB0gBjIywXLAlAFzxZQA/oCE8tqyx8Syz/Jc/sAAAr0AMntVAj45Sg=",
    "base64",
  ),
)[0];

const WALLET_V4R2_SUBWALLET_ID = 698983191;

// ── Ed25519 key extraction ──────────────────────────────────────

function extractEd25519Key(pubKeyBytes: Uint8Array): Buffer {
  let key32: Uint8Array;
  if (pubKeyBytes.length === 32) {
    key32 = pubKeyBytes;
  } else if (pubKeyBytes.length === 65 && pubKeyBytes[0] === 0x04) {
    const x_be = pubKeyBytes.slice(1, 33);
    const y_le = pubKeyBytes.slice(33).reverse();
    key32 = new Uint8Array(y_le);
    key32[31] = (key32[31] & 0x7f) | ((x_be[31] & 1) << 7);
  } else {
    throw new Error(`Expected 32 or 65-byte Ed25519 public key, got ${pubKeyBytes.length} bytes`);
  }
  return Buffer.from(key32);
}

/** Build the state init for wallet V4R2 (needed for first tx from uninitialized wallet) */
function buildWalletStateInit(pubKey: Buffer): Cell {
  const data = beginCell()
    .storeUint(0, 32) // seqno
    .storeUint(WALLET_V4R2_SUBWALLET_ID, 32)
    .storeBuffer(pubKey, 32)
    .endCell();

  return beginCell()
    .storeBit(false) // split_depth
    .storeBit(false) // special
    .storeBit(true)  // code present
    .storeRef(WALLET_V4R2_CODE)
    .storeBit(true)  // data present
    .storeRef(data)
    .storeBit(false) // library
    .endCell();
}

// ── Account state check ─────────────────────────────────────────

/** Check if a TON wallet is initialized (contract deployed) */
export async function isTonWalletInitialized(rpcUrl: string, address: string): Promise<boolean> {
  const url = new URL(`${rpcUrl}/getAddressInformation`);
  url.searchParams.set("address", address);
  const res = await fetch(url.toString());
  if (!res.ok) return false;
  const data = await res.json();
  if (!data.ok) return false;
  // state can be "active", "uninitialized", "frozen"
  return data.result?.state === "active";
}

// ── Seqno fetching ──────────────────────────────────────────────

export async function getTonSeqno(rpcUrl: string, address: string): Promise<number> {
  const url = new URL(`${rpcUrl}/runGetMethod`);
  url.searchParams.set("address", address);
  url.searchParams.set("method", "seqno");
  url.searchParams.set("stack", "[]");
  const res = await fetch(url.toString());
  if (!res.ok) return 0; // Uninitialized wallet → seqno 0
  const data = await res.json();
  if (!data.ok) return 0;
  const stack = data.result?.stack;
  if (!stack || stack.length === 0) return 0;
  return parseInt(stack[0][1], 16) || 0;
}

// ── Transaction building ────────────────────────────────────────

export interface TonTransferParams {
  eddsaPubKeyHex: string;
  to: string;
  amount: string; // in TON (e.g. "1.5")
  seqno: number;
  memo?: string;
}

/**
 * Build the unsigned message body (inner transfer) for wallet v4r2.
 * Returns the cell hash (to be signed) and the serialized body (to send to server).
 */
export function buildTonTransferMessage(params: TonTransferParams): {
  hash: Uint8Array;
  unsignedBody: string; // base64 BOC
} {
  const { to, amount, seqno, memo } = params;

  const destAddr = Address.parse(to);
  const amountNano = toNano(amount);

  const internalMsg = internal({
    to: destAddr,
    value: amountNano,
    bounce: false,
    body: memo ? beginCell().storeUint(0, 32).storeStringTail(memo).endCell() : undefined,
  });

  // Wallet v4r2 signing body:
  // subwallet_id(32) + valid_until(32) + seqno(32) + op(8) + send_mode(8) + msg_ref
  const validUntil = Math.floor(Date.now() / 1000) + 300; // 5 min expiry
  const msgCell = beginCell().store(storeMessageRelaxed(internalMsg)).endCell();
  const body = beginCell()
    .storeUint(698983191, 32) // subwallet_id
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32)
    .storeUint(0, 8) // simple send op
    .storeUint(SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS, 8)
    .storeRef(msgCell)
    .endCell();

  const hash = body.hash();
  const boc = body.toBoc().toString("base64");

  return { hash: new Uint8Array(hash), unsignedBody: boc };
}

/**
 * Assemble the signed external message (ready for broadcast).
 * Combines the signature with the unsigned body and wraps in an external message.
 * If eddsaPubKeyHex is provided and includeStateInit is true, includes the wallet
 * state init for deploying uninitialized wallets on first transaction.
 */
export function assembleTonSignedMessage(
  walletAddress: string,
  unsignedBodyBase64: string,
  signature: Uint8Array,
  options?: { eddsaPubKeyHex?: string; includeStateInit?: boolean },
): string {
  const addr = Address.parse(walletAddress);
  const body = Cell.fromBoc(Buffer.from(unsignedBodyBase64, "base64"))[0];

  // Signed body = signature(512 bits) + original body
  const signedBody = beginCell()
    .storeBuffer(Buffer.from(signature), 64)
    .storeSlice(body.asSlice())
    .endCell();

  // Build state init if this is the first tx from an uninitialized wallet
  const needsStateInit = options?.includeStateInit && options?.eddsaPubKeyHex;
  let stateInit: Cell | null = null;
  if (needsStateInit) {
    const pubKey = extractEd25519Key(hexToBytes(options!.eddsaPubKeyHex!));
    stateInit = buildWalletStateInit(pubKey);
  }

  // External message to the wallet contract
  const ext = beginCell()
    .storeUint(0b10, 2) // ext_in_msg_info tag
    .storeUint(0, 2) // src: addr_none
    .storeAddress(addr)
    .storeCoins(0) // import_fee
    .storeBit(stateInit !== null) // state init present?
    .storeMaybeRef(stateInit)
    .storeBit(true) // body as ref
    .storeRef(signedBody)
    .endCell();

  return ext.toBoc().toString("base64");
}

// ── Broadcasting ────────────────────────────────────────────────

export async function broadcastTonTransaction(rpcUrl: string, bocBase64: string): Promise<string> {
  const url = new URL(`${rpcUrl}/sendBoc`);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boc: bocBase64 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TON broadcast failed: ${err}`);
  }
  const data = await res.json();
  if (!data.ok) throw new Error(`TON broadcast error: ${data.error || "unknown"}`);
  // Compute tx hash from the BOC
  const cell = Cell.fromBoc(Buffer.from(bocBase64, "base64"))[0];
  return cell.hash().toString("hex");
}

/** Poll for TON transaction confirmation via seqno increment */
export async function waitForTonConfirmation(
  rpcUrl: string,
  address: string,
  expectedSeqno: number,
  _onStatus: () => void,
  maxAttempts = 30,
  intervalMs = 3000,
): Promise<{ confirmed: boolean }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const currentSeqno = await getTonSeqno(rpcUrl, address);
    if (currentSeqno > expectedSeqno) return { confirmed: true };
  }
  return { confirmed: false };
}
