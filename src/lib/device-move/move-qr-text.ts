// QR text of a device move: kexify-move:v1:<transferId>:<nonce>:<ephPubkey b64url>:<devicePubkey b64url>.
// The keys are the same bytes the new device sent to POST /transfers (base64 there, base64url here).
import { b64, b64url, bytesEqual, fromB64, fromB64url, sha256HexOf, utf8 } from "./move-codec";

export interface MoveQr {
  transferId: string;
  /** 64 hex chars, from POST /transfers. */
  nonce: string;
  /** 32-byte X25519 public key. */
  ephPubkey: Uint8Array;
  /** SPKI DER of the new device key (P-256). */
  devicePubkey: Uint8Array;
}

const PREFIX = "kexify-move:v1:";

export function encodeMoveQr(q: MoveQr): string {
  return `${PREFIX}${q.transferId}:${q.nonce}:${b64url(q.ephPubkey)}:${b64url(q.devicePubkey)}`;
}

/** The parsed QR, or null for anything that is not a well-formed v1 move code. */
export function parseMoveQr(text: string): MoveQr | null {
  const s = text.trim();
  if (!s.startsWith(PREFIX)) return null;
  const parts = s.slice(PREFIX.length).split(":");
  if (parts.length !== 4) return null;
  const [transferId, nonce, eph, dev] = parts;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(transferId) || !/^[0-9a-f]{64}$/.test(nonce)) return null;
  try {
    const ephPubkey = fromB64url(eph);
    const devicePubkey = fromB64url(dev);
    if (ephPubkey.length !== 32 || devicePubkey.length !== 91) return null;
    return { transferId, nonce, ephPubkey, devicePubkey };
  } catch {
    return null;
  }
}

/** What the server holds for the transfer (GET /transfers/:id), base64 keys. */
export interface ServerTransferKeys { transferId: string; nonce: string; ephPubkey: string; devicePubkey: string }

/** The relay cannot swap keys: the server's copy must equal the QR's, byte for byte. */
export function qrMatchesServer(qr: MoveQr, t: ServerTransferKeys): boolean {
  try {
    return t.transferId === qr.transferId && t.nonce === qr.nonce
      && bytesEqual(fromB64(t.ephPubkey), qr.ephPubkey) && bytesEqual(fromB64(t.devicePubkey), qr.devicePubkey);
  } catch {
    return false;
  }
}

/** Base64 SPKI of the QR's device key (what the signer messages hash). */
export const qrDeviceSpkiB64 = (qr: MoveQr) => b64(qr.devicePubkey);

/** No-camera code: first 12 hex chars, upper case, of sha256(utf8("<devicePubkey b64>|<ephPubkey b64>|<nonce>")). Computed locally on both devices. */
export async function moveFingerprint(devicePubkeyB64: string, ephPubkeyB64: string, nonce: string): Promise<string> {
  return (await sha256HexOf(utf8(`${devicePubkeyB64}|${ephPubkeyB64}|${nonce}`))).slice(0, 12).toUpperCase();
}
