// Verifiable (PVE) self-custody export of the server key share.
//
// Export: the browser makes a fresh PVE keypair, the server encrypts its scalar x2 to
// it and returns the rest of its key with x2 blanked. The browser checks the
// ciphertext against the server's claimed Q2 before saving. The file keeps the payload
// (plus dk) in the usual `share` / `eddsaShare` fields, so passphrase encryption and
// import work unchanged.
//
// Restore (recovery mode): Q2 is recomputed from the client's own share as
// Q - x1*G, so a backup only restores if it really holds the matching server share.

// Pure (no DOM / network) so the server-client format contract can be tested from the
// MPC server's test suite; the network call lives in pve-server-share-request.ts.

import type { CbMpc, PointHandle } from "cb-mpc";
import { sharePartsFromString, wipe } from "./secret-bytes";

// OpenSSL NIDs (same values as cb-mpc's exports; kept local so this module has no
// runtime dependency and the MPC server's tests can import it without frontend deps).
const NID_secp256k1 = 714;
const NID_ED25519 = 1087;

function toBase64(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export type PveShareKind = "ecdsa" | "eddsa";

const PVE_FORMAT = "kexify-pve-v1";
/** Index of the x_share segment in serializeEcdsa2p / serializeEcKey2p output. */
const X_SHARE_INDEX = 3;
/** Index of the curve and joint public key Q in the same serialization. */
const CURVE_INDEX = 1;
const Q_INDEX = 2;
/** ECDSA-2P only: c_key (Paillier encryption of x1), identical in both parties' keys. */
const C_KEY_INDEX = 4;
/** ECDSA-2P only: Paillier key; P1 holds 0x01 || N || p || q, P2 holds 0x00 || N. */
const PAILLIER_INDEX = 5;

/** Payload returned by the server; `dk` is added by the browser before saving. */
export interface PveSharePayload {
  format: typeof PVE_FORMAT;
  kind: PveShareKind;
  curve: number;
  label: string;
  ct: string;
  q2: string;
  detached: string;
  ek?: string;
  dk?: string;
}

export function pveLabel(keyShareId: string, kind: PveShareKind): string {
  return `kexify:server-share:v1:${keyShareId}:${kind}`;
}

function curveFor(kind: PveShareKind): number {
  return kind === "ecdsa" ? NID_secp256k1 : NID_ED25519;
}

/** True when a key-file share field holds a PVE payload rather than a serialized key. */
export function isPveShare(share: string | undefined): boolean {
  if (!share || !share.trimStart().startsWith("{")) return false;
  try {
    return (JSON.parse(share) as { format?: unknown }).format === PVE_FORMAT;
  } catch {
    return false;
  }
}

/** Validate the shape and binding (kind, curve, label) of a payload for this key. */
function checkPayload(p: PveSharePayload, keyShareId: string, kind: PveShareKind): void {
  if (p?.format !== PVE_FORMAT || p.kind !== kind) throw new Error("Not a PVE server share");
  const strings = [p.label, p.ct, p.q2, p.detached, ...(p.ek !== undefined ? [p.ek] : []), ...(p.dk !== undefined ? [p.dk] : [])];
  if (!strings.every((v) => typeof v === "string")) throw new Error("Malformed PVE server share");
  if (p.curve !== curveFor(kind)) throw new Error("PVE share curve mismatch");
  if (p.label !== pveLabel(keyShareId, kind)) throw new Error("PVE share belongs to another key");
  const parts = p.detached.split(",");
  if (parts.length !== (kind === "ecdsa" ? 6 : 4) || parts[X_SHARE_INDEX] !== "") {
    throw new Error("Malformed PVE server share");
  }
}

/**
 * Check a freshly exported payload and return the key-file field (JSON with ek + dk).
 * Without `clientShare` this only checks the ciphertext against the server's claimed
 * Q2; with it, the backup is test-restored against the client share. Throws on failure.
 */
export function sealPveExport(
  mpc: CbMpc,
  payload: PveSharePayload,
  ek: Uint8Array,
  dk: Uint8Array,
  keyShareId: string,
  kind: PveShareKind,
  clientShare?: string,
): string {
  checkPayload(payload, keyShareId, kind);
  const ok = mpc.pveBatchVerify(
    payload.curve,
    ek,
    fromBase64(payload.ct),
    [fromBase64(payload.q2)],
    new TextEncoder().encode(payload.label),
  );
  if (!ok) throw new Error("Server share backup failed verification");
  const field = JSON.stringify({ ...payload, ek: toBase64(ek), dk: toBase64(dk) });
  // With the client share at hand, run the full restore now (Q2 from x1, key binding)
  // so a backup is only called verified if it will actually restore.
  if (clientShare) openPveServerShare(mpc, field, clientShare, keyShareId, kind)[X_SHARE_INDEX].fill(0);
  return field;
}

/** cb-mpc bn_t serialization of a non-negative scalar: header (len << 1) then big-endian bytes. */
function serializeScalar(x: Uint8Array): Uint8Array {
  let start = 0;
  while (start < x.length && x[start] === 0) start++;
  const len = x.length - start;
  if (len > 0x3f) throw new Error("Scalar too large");
  const out = new Uint8Array(1 + len);
  out[0] = len << 1;
  out.set(x.subarray(start), 1);
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The server's public Paillier key (0x00 || N) carries the same N as the client's private one. */
function samePaillierModulus(client: Uint8Array, server: Uint8Array): boolean {
  if (client[0] !== 0x01 || server[0] !== 0x00 || server.length < 2 || client.length < server.length) return false;
  return sameBytes(client.subarray(1, server.length), server.subarray(1));
}

/**
 * Rebuild the serialized server share ("part,part,..." base64) from a PVE key-file
 * field, using the client share to derive the trusted Q2 = Q - x1*G.
 */
export function restorePveServerShare(
  mpc: CbMpc,
  pveField: string,
  clientShare: string,
  keyShareId: string,
  kind: PveShareKind,
): string {
  const parts = openPveServerShare(mpc, pveField, clientShare, keyShareId, kind);
  try {
    return parts.map((b) => toBase64(b)).join(",");
  } finally {
    parts[X_SHARE_INDEX].fill(0);
  }
}

/** Verify + decrypt + rebuild; returns the serialized server key parts (x_share is secret). */
function openPveServerShare(
  mpc: CbMpc,
  pveField: string,
  clientShare: string,
  keyShareId: string,
  kind: PveShareKind,
): Uint8Array[] {
  const p = JSON.parse(pveField) as PveSharePayload;
  checkPayload(p, keyShareId, kind);
  if (!p.ek || !p.dk) throw new Error("PVE server share has no decryption key");
  if (!clientShare) throw new Error(`Client file has no ${kind === "ecdsa" ? "ECDSA" : "EdDSA"} share`);

  const clientParts = sharePartsFromString(clientShare);
  // The client parts hold x1 and the Paillier key: wiped however this ends.
  try {
    const detached = p.detached.split(",").map((s) => fromBase64(s));
    // Everything the server sends besides x2 must match what the client already holds
    // (c_key is created in DKG and kept by both parties), so a server cannot hand back
    // a key that loads but cannot sign.
    const bound = [CURVE_INDEX, Q_INDEX, ...(kind === "ecdsa" ? [C_KEY_INDEX] : [])];
    if (clientParts.length !== detached.length || !bound.every((i) => sameBytes(clientParts[i], detached[i]))) {
      throw new Error("Server share does not match this key");
    }
    if (kind === "ecdsa" && !samePaillierModulus(clientParts[PAILLIER_INDEX], detached[PAILLIER_INDEX])) {
      throw new Error("Server share does not match this key");
    }

    const points: PointHandle[] = [];
    const track = (pt: PointHandle): PointHandle => (points.push(pt), pt);
    let x1: Uint8Array = new Uint8Array(0);
    let x2: Uint8Array = new Uint8Array(0);
    let dk: Uint8Array = new Uint8Array(0);
    let curve: ReturnType<CbMpc["createCurve"]> | undefined;
    try {
      x1 = clientScalar(mpc, clientParts, kind);
      curve = mpc.createCurve(p.curve);
      const Q = track(mpc.pointFromBytes(clientParts[Q_INDEX]));
      const Q2 = track(mpc.pointSubtract(Q, track(mpc.mulGenerator(curve, x1))));
      const q2Trusted = mpc.pointToBytes(Q2);
      const label = new TextEncoder().encode(p.label);
      const ek = fromBase64(p.ek);
      const ct = fromBase64(p.ct);
      if (!mpc.pveBatchVerify(p.curve, ek, ct, [q2Trusted], label)) {
        throw new Error("Server share backup failed verification");
      }
      dk = fromBase64(p.dk);
      [x2] = mpc.pveBatchDecrypt(p.curve, dk, ek, ct, label);
      if (!mpc.pointEquals(track(mpc.mulGenerator(curve, x2)), Q2)) {
        throw new Error("Decrypted server share does not match");
      }

      const parts = detached.map((b, i) => (i === X_SHARE_INDEX ? serializeScalar(x2) : b));
      // Load the rebuilt key once: runs cb-mpc's own key checks and pins the role
      // (a server-supplied role 0 would load but never sign).
      let role = -1;
      try {
        role = serverRole(mpc, parts, kind);
      } finally {
        if (role !== 1) parts[X_SHARE_INDEX].fill(0);
      }
      if (role !== 1) throw new Error("Server share does not match this key");
      return parts;
    } finally {
      x1.fill(0);
      x2.fill(0);
      dk.fill(0);
      for (const pt of points) mpc.freePoint(pt);
      if (curve !== undefined) mpc.freeCurve(curve);
    }
  } finally {
    wipe(clientParts);
  }
}

/** Role index of a serialized server key; the key handle is always freed. */
function serverRole(mpc: CbMpc, parts: Uint8Array[], kind: PveShareKind): number {
  if (kind === "ecdsa") {
    const key = mpc.deserializeEcdsa2p(parts);
    try {
      const info = mpc.ecdsa2pKeyInfo(key);
      info.xShare.fill(0);
      return info.roleIndex;
    } finally {
      mpc.freeEcdsa2pKey(key);
    }
  }
  const key = mpc.deserializeEcKey2p(parts);
  try {
    const info = mpc.ecKey2pInfo(key);
    info.xShare.fill(0);
    return info.roleIndex;
  } finally {
    mpc.freeEcKey2p(key);
  }
}

/** x1 from the client's serialized share (party 0 only); the key handle is always freed. */
function clientScalar(mpc: CbMpc, clientParts: Uint8Array[], kind: PveShareKind): Uint8Array {
  if (kind === "ecdsa") {
    const key = mpc.deserializeEcdsa2p(clientParts);
    try {
      const info = mpc.ecdsa2pKeyInfo(key);
      if (info.roleIndex !== 0) {
        info.xShare.fill(0);
        throw new Error("Peer 1 file is not the client share");
      }
      return info.xShare;
    } finally {
      mpc.freeEcdsa2pKey(key);
    }
  }
  const key = mpc.deserializeEcKey2p(clientParts);
  try {
    const info = mpc.ecKey2pInfo(key);
    if (info.roleIndex !== 0) {
      info.xShare.fill(0);
      throw new Error("Peer 1 file is not the client share");
    }
    return info.xShare;
  } finally {
    mpc.freeEcKey2p(key);
  }
}

