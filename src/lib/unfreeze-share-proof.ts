/**
 * Unfreeze an account that has no active passkey by proving this browser holds a wallet's
 * client share: sign the server's challenge with the ECDSA share scalar x1 alone.
 * The server checks it against Q1 = Q − Q2 and schedules the usual cooling-period unfreeze.
 * A signature by x1 alone can never be used as a signature by the wallet key.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { KeyFileData } from "./crypto";
import { getMpcInstance, fromBase64 } from "./mpc";
import { authHeaders } from "./auth";
import { apiUrl } from "./apiBase";

const METHOD = "share-possession";

/** Must match api/src/routes/account-unfreeze-without-passkey.ts unfreezeProofMessage(). */
function proofMessage(challengeHex: string, keyShareId: string): Uint8Array {
  return new TextEncoder().encode(`kexify-unfreeze:v1:${METHOD}:${keyShareId}:${challengeHex}`);
}

/** x1 mod n from the client's serialized ECDSA share, as 32 bytes; the key handle is freed. */
async function clientScalar(share: string): Promise<Uint8Array> {
  const mpc = await getMpcInstance();
  const key = mpc.deserializeEcdsa2p(share.split(",").map((s) => fromBase64(s)));
  try {
    const info = mpc.ecdsa2pKeyInfo(key);
    try {
      if (info.roleIndex !== 0) throw new Error("Not a client share");
      const n = secp256k1.Point.CURVE().n;
      // A refreshed share may exceed n; reduce it.
      const x1 = BigInt("0x" + Array.from(info.xShare, (b) => b.toString(16).padStart(2, "0")).join("")) % n;
      if (x1 === 0n) throw new Error("Invalid share");
      return Uint8Array.from(x1.toString(16).padStart(64, "0").match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    } finally {
      info.xShare.fill(0);
    }
  } finally {
    mpc.freeEcdsa2pKey(key);
  }
}

async function post(path: string, body: unknown) {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.code || data?.error || String(res.status));
  return data;
}

/** Returns the scheduled unfreeze time. */
export async function unfreezeWithSharePossession(keyData: KeyFileData): Promise<string> {
  const { challengeId, challenge } = await post("/api/account/unfreeze-proof/challenge", { keyShareId: keyData.id });
  const x1 = await clientScalar(keyData.share);
  let signature: Uint8Array;
  try {
    signature = secp256k1.sign(proofMessage(challenge, keyData.id), x1);
  } finally {
    x1.fill(0);
  }
  const hex = Array.from(signature, (b) => b.toString(16).padStart(2, "0")).join("");
  const { unfreezeAt } = await post("/api/account/unfreeze-proof/verify", { challengeId, signature: hex });
  return unfreezeAt as string;
}
