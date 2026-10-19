// Automatic re-key after a device move (contract step 8): both parties get new copies of the same key,
// so every older copy and backup stops working. ECDSA then EdDSA over /keys/:id/share-refresh/init + /step
// (cb-mpc party 0, names client/server); then the new backup (with its slot: envelope) and the commit with a
// proof by the new ECDSA copy. Nothing local changes until the commit succeeded: the caller stores the result then.
import type { DataTransport } from "cb-mpc";
import { apiUrl } from "../apiBase";
import type { KeyFileData } from "../crypto";
import { createHttpTransport, getMpcInstance, toBase64, toHex, type CbMpc, type Ecdsa2pKeyHandle, type EcKey2pHandle } from "../mpc";
import { freeClientKeyHandles, type ClientKeyHandles } from "../client-key-cache";
import { deviceSign, type SignerRecord } from "../device-signer-key";
import { fetchSignerNonce } from "../signer-api";
import { clientScalarFromHandle, shareProofHex } from "../unfreeze-share-proof";
import { workspaceHeaders } from "../workspace-token";
import { sharePartsFromString, wipe } from "../secret-bytes";
import { sha256HexOf, utf8 } from "./move-codec";
import { refreshMessage } from "./move-signer-messages";
import { envelopesJson, type EscrowEnvelope } from "./move-escrow-envelopes";

const PARTY_NAMES: [string, string] = ["client", "server"];

export class RefreshError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "RefreshError"; this.code = code; }
}

export type MoveSigner = SignerRecord & { signerId: string };
const base = (id: string) => apiUrl(`/api/keys/${encodeURIComponent(id)}/share-refresh`);

async function post<T>(keyShareId: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base(keyShareId)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await workspaceHeaders(keyShareId)) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new RefreshError(String(data?.code ?? data?.error ?? res.status));
  return data as T;
}

/** One 2P refresh over HTTP; resolves with the new handle once the server staged generation `target`. */
async function refreshOne<H>(keyShareId: string, signer: MoveSigner, algorithm: "ecdsa" | "eddsa", target: number,
  run: (t: DataTransport) => Promise<H>): Promise<H> {
  const nonce = await fetchSignerNonce(keyShareId);
  const sig = await deviceSign(signer, refreshMessage(`init-${algorithm}`, keyShareId, target, nonce));
  const tr = createHttpTransport({
    initUrl: `${base(keyShareId)}/init`, stepUrl: `${base(keyShareId)}/step`,
    initExtra: { algorithm, signerId: signer.signerId, nonce, sig }, headers: await workspaceHeaders(keyShareId),
  });
  const handle = await Promise.race([run(tr.transport), tr.transportFailed]).catch((err) => {
    throw new RefreshError(String((err as { code?: string })?.code ?? tr.getError()?.message ?? "REFRESH_FAILED"));
  });
  const r = tr.getServerResult()?.refreshResult as { algorithm?: string; stagedGeneration?: number } | undefined;
  if (!r || r.algorithm !== algorithm || r.stagedGeneration !== target) throw new RefreshError("REFRESH_FAILED");
  return handle;
}

const serialize = (parts: Uint8Array[]) => parts.map((p) => toBase64(p)).join(",");

/** A refresh whose halves the server has staged: the new copy, not committed yet. */
export interface StagedRefresh {
  /** The new key file (generation target); store it only after the commit. */
  keyFile: KeyFileData;
  /** Handles of the new copy: to clientKeys after the commit, else freed. */
  handles: ClientKeyHandles;
  target: number;
}

/** ECDSA then EdDSA refresh into generation `generation + 1`; the public keys must stay the same. */
export async function runRefresh(opts: {
  keyShareId: string; signer: MoveSigner; keyFile: KeyFileData; generation: number;
  onPhase?: (phase: "ecdsa" | "eddsa") => void;
}): Promise<StagedRefresh> {
  const { keyShareId, signer, keyFile, generation } = opts;
  const target = generation + 1;
  const mpc: CbMpc = await getMpcInstance();
  const old: ClientKeyHandles = { mpc };
  const next: ClientKeyHandles = { mpc };
  try {
    const ep = sharePartsFromString(keyFile.share);
    try { old.ecdsa = mpc.deserializeEcdsa2p(ep); } finally { wipe(ep); }
    const withEddsa = !!keyFile.eddsaPublicKey && !!keyFile.eddsaShare;
    if (withEddsa) {
      const dp = sharePartsFromString(keyFile.eddsaShare);
      try { old.eddsa = mpc.deserializeEcKey2p(dp); } finally { wipe(dp); }
    }
    opts.onPhase?.("ecdsa");
    next.ecdsa = await refreshOne<Ecdsa2pKeyHandle>(keyShareId, signer, "ecdsa", target, (t) => mpc.ecdsa2pRefresh(t, 0, PARTY_NAMES, old.ecdsa!));
    if (toHex(mpc.ecdsa2pKeyInfo(next.ecdsa).publicKey).toLowerCase() !== keyFile.publicKey.toLowerCase()) throw new RefreshError("PUBLIC_KEY_MISMATCH");
    if (withEddsa) {
      opts.onPhase?.("eddsa");
      next.eddsa = await refreshOne<EcKey2pHandle>(keyShareId, signer, "eddsa", target, (t) => mpc.ecKey2pRefresh(t, 0, PARTY_NAMES, old.eddsa!));
      // Party 0's view of the EdDSA key (what addresses use) is the same before and after.
      if (toHex(mpc.ecKey2pInfo(next.eddsa).publicKey) !== toHex(mpc.ecKey2pInfo(old.eddsa!).publicKey)) throw new RefreshError("PUBLIC_KEY_MISMATCH");
    }
    const fresh: KeyFileData = {
      id: keyShareId, peer: 0, publicKey: keyFile.publicKey, eddsaPublicKey: keyFile.eddsaPublicKey ?? "",
      share: serialize(mpc.serializeEcdsa2p(next.ecdsa)),
      eddsaShare: next.eddsa ? serialize(mpc.serializeEcKey2p(next.eddsa)) : "",
      ...(keyFile.type ? { type: keyFile.type } : {}),
      shareGeneration: target,
    };
    return { keyFile: fresh, handles: next, target };
  } catch (err) {
    freeClientKeyHandles(next);
    throw err;
  } finally {
    freeClientKeyHandles(old);
  }
}

/**
 * Upload the backup of the staged copy (only after BOTH refresh halves: an ecdsa init drops earlier g+1
 * envelopes), then commit with a proof by the new ECDSA copy. After a failed commit retry THIS, not the
 * refresh: the server keeps the staged keys sealed until its 15 min rollback.
 */
export async function backupAndCommit(opts: {
  keyShareId: string; signer: MoveSigner; staged: StagedRefresh; envelopes: EscrowEnvelope[] | null;
  /** The user chose to go on without a new server backup. */
  noBackup?: boolean;
}): Promise<void> {
  const { keyShareId, signer, staged, envelopes } = opts;
  const { target, handles } = staged;
  if (envelopes?.length && !opts.noBackup) {
    const json = envelopesJson(envelopes);
    const nonce = await fetchSignerNonce(keyShareId);
    const sig = await deviceSign(signer, refreshMessage("backup", keyShareId, target, nonce, await sha256HexOf(utf8(json))));
    try {
      await post(keyShareId, "/backup", { generation: target, envelopesJson: json, signerId: signer.signerId, nonce, sig });
    } catch (err) {
      // A retry after a commit that went through (its answer was lost): straight to the commit retry.
      if (!(err instanceof RefreshError && err.code === "ALREADY_COMMITTED")) throw err;
    }
  }
  const nonce = await fetchSignerNonce(keyShareId);
  const msg = refreshMessage("commit", keyShareId, target, nonce);
  const x1 = await clientScalarFromHandle(handles.mpc, handles.ecdsa!);
  let shareProof: string;
  try { shareProof = shareProofHex(msg, x1); } finally { x1.fill(0); }
  const sig = await deviceSign(signer, msg);
  // An already committed move (lost answer) answers { generation, already: true }: same outcome.
  const out = await post<{ generation: number; already?: boolean }>(keyShareId, "/commit", {
    generation: target, signerId: signer.signerId, nonce, sig, shareProof, ...(opts.noBackup ? { noBackup: true } : {}),
  });
  if (out.generation !== target) throw new RefreshError("SHARE_GENERATION_MISMATCH");
}
