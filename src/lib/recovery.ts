// Recovery Mode — runs both MPC peers locally in the browser
// when the user imports both key share files (peer1 + peer2).

import type { KeyFileData } from "./crypto";
import type { KeyShare } from "../shared/types";
import type { CbMpc, DataTransport, Ecdsa2pKeyHandle, EcKey2pHandle } from "cb-mpc";
import { allOrFailure, getMpcInstance } from "./mpc";
import { sharePartsFromString, wipe } from "./secret-bytes";
import { isPveShare, restorePveServerShare } from "./pve-server-share";
import type { MpcSignResult, BatchMpcSignResult } from "./mpc";
import { setRecoveryActive } from "./recovery-flag";

// ── Module-level state ──

let peer1: KeyFileData | null = null; // party 0 (client share)
let peer2: KeyFileData | null = null; // party 1 (server share)

interface RecoveryHandles {
  mpc0: CbMpc;
  mpc1: CbMpc;
  ecdsa0?: Ecdsa2pKeyHandle;
  ecdsa1?: Ecdsa2pKeyHandle;
  eddsa0?: EcKey2pHandle;
  eddsa1?: EcKey2pHandle;
}

let handles: RecoveryHandles | null = null;
/** Local signing runs in flight, and handles retired while they ran (freed when the last ends). */
let signing = 0;
const retired: RecoveryHandles[] = [];

/** Free (and so zero, inside cb-mpc) every key handle of a recovery session. */
function freeRecoveryHandles(h: RecoveryHandles): void {
  try { if (h.ecdsa0) h.mpc0.freeEcdsa2pKey(h.ecdsa0); } catch { /* already gone */ }
  try { if (h.ecdsa1) h.mpc1.freeEcdsa2pKey(h.ecdsa1); } catch { /* already gone */ }
  try { if (h.eddsa0) h.mpc0.freeEcKey2p(h.eddsa0); } catch { /* already gone */ }
  try { if (h.eddsa1) h.mpc1.freeEcKey2p(h.eddsa1); } catch { /* already gone */ }
  h.ecdsa0 = h.ecdsa1 = undefined;
  h.eddsa0 = h.eddsa1 = undefined;
}

function retire(h: RecoveryHandles): void {
  if (signing > 0) retired.push(h);
  else freeRecoveryHandles(h);
}

/** Run with the current handles; an exit meanwhile frees them only after the run. */
async function withHandles<T>(fn: (h: RecoveryHandles) => Promise<T>): Promise<T> {
  const h = handles;
  if (!h) throw new Error("Recovery mode not initialized");
  signing++;
  try {
    return await fn(h);
  } finally {
    signing--;
    if (signing === 0) retired.splice(0).forEach(freeRecoveryHandles);
  }
}

// ── Auto-lock (15 min inactivity) ──

const AUTO_LOCK_MS = 15 * 60 * 1000;
let lockTimer: ReturnType<typeof setTimeout> | null = null;

function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  if (!isRecoveryMode()) return;
  lockTimer = setTimeout(() => {
    exitRecoveryMode();
    window.location.href = "/login";
  }, AUTO_LOCK_MS);
}

function startAutoLock() {
  const events = ["mousedown", "keydown", "touchstart", "scroll"];
  events.forEach((e) => window.addEventListener(e, resetLockTimer, { passive: true }));
  resetLockTimer();
}

function stopAutoLock() {
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  const events = ["mousedown", "keydown", "touchstart", "scroll"];
  events.forEach((e) => window.removeEventListener(e, resetLockTimer));
}

// ── Public API ──

export function isRecoveryMode(): boolean {
  return peer1 !== null && peer2 !== null;
}

export async function enterRecoveryMode(p1: KeyFileData, p2: KeyFileData): Promise<void> {
  // Build everything first and switch the module state only once it all worked, so a
  // bad file never leaves recovery mode half-entered.
  // Each peer needs its own MPC instance (WASM handles are instance-bound)
  const mpc0 = await getMpcInstance();
  // Create a second independent instance
  const { initCbMpc } = await import("cb-mpc");
  // @ts-expect-error -- cb-mpc has no type declarations
  const mod = await import("cb-mpc/cbmpc.js");
  const { default: wasmUrl } = await import("cb-mpc/cbmpc.wasm?url");
  const rawFactory = mod.default || mod.createCbMpc || mod;
  const factory = (opts?: Record<string, unknown>) =>
    rawFactory({ ...opts, locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path) });
  const mpc1 = await initCbMpc(factory as unknown as Parameters<typeof initCbMpc>[0]);

  const h: RecoveryHandles = { mpc0, mpc1 };

  // A verifiable (PVE) server export holds an encrypted scalar instead of the
  // serialized key: verify it against the client share and rebuild the key.
  if (isPveShare(p2.share) || isPveShare(p2.eddsaShare)) {
    if (p1.id !== p2.id) throw new Error("Key files belong to different keys");
    p2 = {
      ...p2,
      share: isPveShare(p2.share) ? restorePveServerShare(mpc1, p2.share, p1.share, p1.id, "ecdsa") : p2.share,
      eddsaShare: isPveShare(p2.eddsaShare)
        ? restorePveServerShare(mpc1, p2.eddsaShare, p1.eddsaShare, p1.id, "eddsa")
        : p2.eddsaShare,
    };
  }

  try {
    // Restore ECDSA handles (the decoded parts are wiped; cb-mpc keeps its own copy)
    if (p1.share && p2.share) {
      const parts0 = sharePartsFromString(p1.share);
      let parts1: Uint8Array[] = [];
      try {
        parts1 = sharePartsFromString(p2.share);
        h.ecdsa0 = mpc0.deserializeEcdsa2p(parts0);
        h.ecdsa1 = mpc1.deserializeEcdsa2p(parts1);
      } finally {
        wipe(parts0, parts1);
      }
    }

    // Restore EdDSA handles
    if (p1.eddsaShare && p2.eddsaShare) {
      const parts0 = sharePartsFromString(p1.eddsaShare);
      let parts1: Uint8Array[] = [];
      try {
        parts1 = sharePartsFromString(p2.eddsaShare);
        h.eddsa0 = mpc0.deserializeEcKey2p(parts0);
        h.eddsa1 = mpc1.deserializeEcKey2p(parts1);
      } finally {
        wipe(parts0, parts1);
      }
    }
  } catch (err) {
    freeRecoveryHandles(h);
    throw err;
  }

  // Re-entering replaces a previous session: free its handles.
  if (handles) retire(handles);
  peer1 = p1;
  peer2 = p2;
  setRecoveryActive(true);
  handles = h;
  document.documentElement.setAttribute("data-recovery", "");
  document.documentElement.setAttribute("data-theme", "dark");
  startAutoLock();
}

export function exitRecoveryMode(): void {
  stopAutoLock();
  peer1 = null;
  peer2 = null;
  setRecoveryActive(false);
  if (handles) retire(handles);
  handles = null;
  document.documentElement.removeAttribute("data-recovery");
}

export function getRecoveryKeys(): KeyShare[] {
  if (!peer1) return [];
  return [
    {
      id: peer1.id,
      name: null,
      publicKey: peer1.publicKey || null,
      eddsaPublicKey: peer1.eddsaPublicKey,
      enabled: true,
      enableAt: null,
      createdAt: new Date().toISOString(),
      selfCustodyAt: null,
      hkdfDownloadedAt: null,
      hasClientBackup: false,
    },
  ];
}

export function getRecoveryKeyFile(): KeyFileData | null {
  return peer1;
}

// ── In-memory transport ──

const PARTY_NAMES: [string, string] = ["client", "server"];

/** In-memory transport between the two local peers (exported for tests). */
export function createLocalTransport(): { t0: DataTransport; t1: DataTransport; abort: (err: unknown) => void } {
  // Two message queues: queue01 (party 0 → party 1), queue10 (party 1 → party 0)
  // Each queue buffers messages so send() never drops if receive() hasn't been called yet.
  const queue01: Uint8Array[] = [];
  const queue10: Uint8Array[] = [];
  let wake01: (() => void) | null = null;
  let wake10: (() => void) | null = null;

  function enqueue(queue: Uint8Array[], wake: { current: (() => void) | null }, msg: Uint8Array) {
    queue.push(msg);
    if (wake.current) {
      const w = wake.current;
      wake.current = null;
      w();
    }
  }

  // A failed peer aborts the transport, so the other one stops waiting for a message that never comes.
  let aborted: unknown = null;

  async function dequeue(queue: Uint8Array[], wake: { current: (() => void) | null }): Promise<Uint8Array> {
    while (queue.length === 0) {
      // Not a Uint8Array = an error status for cb-mpc (a throw would leave the WASM call suspended forever).
      if (aborted) return null as unknown as Uint8Array;
      await new Promise<void>((resolve) => { wake.current = resolve; });
    }
    return queue.shift()!;
  }

  const wake01Ref = { get current() { return wake01; }, set current(v) { wake01 = v; } };
  const wake10Ref = { get current() { return wake10; }, set current(v) { wake10 = v; } };

  const t0: DataTransport = {
    send: async (_receiver, message) => {
      enqueue(queue01, wake01Ref, new Uint8Array(message));
      return 0;
    },
    receive: async (_sender) => dequeue(queue10, wake10Ref),
    receiveAll: async (senders) => allOrFailure(await Promise.all(senders.map((s) => t0.receive(s)))),
  };

  const t1: DataTransport = {
    send: async (_receiver, message) => {
      enqueue(queue10, wake10Ref, new Uint8Array(message));
      return 0;
    },
    receive: async (_sender) => dequeue(queue01, wake01Ref),
    receiveAll: async (senders) => allOrFailure(await Promise.all(senders.map((s) => t1.receive(s)))),
  };

  const abort = (err: unknown) => {
    aborted = err ?? new Error("Local MPC peer failed");
    for (const ref of [wake01Ref, wake10Ref]) {
      const w = ref.current;
      ref.current = null;
      w?.();
    }
  };

  return { t0, t1, abort };
}

// ── Local MPC signing ──

/**
 * Like Promise.all, but settles only once both peers have, so a failed peer never lets the handles go while the
 * other still runs. The first failure aborts the transport, which makes the other peer fail fast too.
 */
async function bothPeers<A, B>(runs: [Promise<A>, Promise<B>], abort: (err: unknown) => void): Promise<[A, B]> {
  runs.forEach((r) => r.catch(abort));
  const [a, b] = await Promise.allSettled(runs);
  if (a.status === "rejected") throw a.reason;
  if (b.status === "rejected") throw b.reason;
  return [a.value, b.value];
}

export async function performLocalMpcSign(opts: {
  algorithm: "ecdsa" | "eddsa";
  keyId: string;
  hash: Uint8Array;
  onStep?: (step: number) => void;
}): Promise<MpcSignResult> {
  const { algorithm, hash, onStep } = opts;
  return withHandles((handles) => localSign(handles, algorithm, hash, onStep));
}

async function localSign(
  handles: RecoveryHandles, algorithm: "ecdsa" | "eddsa", hash: Uint8Array, onStep?: (step: number) => void,
): Promise<MpcSignResult> {
  const startedAt = Date.now();
  onStep?.(1);

  const { t0, t1, abort } = createLocalTransport();
  let sigRaw: Uint8Array;

  if (algorithm === "eddsa") {
    const key0 = handles.eddsa0;
    const key1 = handles.eddsa1;
    if (!key0 || !key1) throw new Error("No EdDSA key handles available");

    const [sig0] = await bothPeers([
      handles.mpc0.schnorr2pEddsaSign(t0, 0, PARTY_NAMES, key0, hash),
      handles.mpc1.schnorr2pEddsaSign(t1, 1, PARTY_NAMES, key1, hash),
    ], abort);
    sigRaw = sig0;
  } else {
    const key0 = handles.ecdsa0;
    const key1 = handles.ecdsa1;
    if (!key0 || !key1) throw new Error("No ECDSA key handles available");

    // Both parties must use the same session ID
    const sigSessionId = new Uint8Array(32);
    crypto.getRandomValues(sigSessionId);

    const [sigs0] = await bothPeers([
      handles.mpc0.ecdsa2pSign(t0, 0, PARTY_NAMES, key0, sigSessionId, [hash]),
      handles.mpc1.ecdsa2pSign(t1, 1, PARTY_NAMES, key1, sigSessionId, [hash]),
    ], abort);
    sigRaw = sigs0[0];
  }

  onStep?.(3);

  if (!sigRaw || sigRaw.length === 0) {
    throw new Error("No signature produced");
  }

  // Pad to at least 1s for UX consistency
  const elapsed = Date.now() - startedAt;
  if (elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed + Math.floor(Math.random() * 500)));
  }

  return { signature: sigRaw, sessionId: `recovery-${Date.now()}` };
}

/**
 * Batch local MPC signing for recovery mode (UTXO chains with multiple inputs).
 * Each hash gets its own MPC session since ecdsa2pSign with multiple hashes
 * requires both parties to be in sync.
 */
export async function performLocalBatchMpcSign(opts: {
  keyId: string;
  hashes: Uint8Array[];
  onStep?: (step: number) => void;
}): Promise<BatchMpcSignResult> {
  const { hashes, onStep } = opts;
  return withHandles((handles) => localBatchSign(handles, hashes, onStep));
}

async function localBatchSign(
  handles: RecoveryHandles, hashes: Uint8Array[], onStep?: (step: number) => void,
): Promise<BatchMpcSignResult> {
  const key0 = handles.ecdsa0;
  const key1 = handles.ecdsa1;
  if (!key0 || !key1) throw new Error("No ECDSA key handles available");

  const startedAt = Date.now();
  onStep?.(1);

  const sigSessionId = new Uint8Array(32);
  crypto.getRandomValues(sigSessionId);

  const { t0, t1, abort } = createLocalTransport();

  const [sigs0] = await bothPeers([
    handles.mpc0.ecdsa2pSign(t0, 0, PARTY_NAMES, key0, sigSessionId, hashes),
    handles.mpc1.ecdsa2pSign(t1, 1, PARTY_NAMES, key1, sigSessionId, hashes),
  ], abort);

  onStep?.(3);

  for (let i = 0; i < sigs0.length; i++) {
    if (!sigs0[i] || sigs0[i].length === 0) {
      throw new Error(`No signature produced for input ${i}`);
    }
  }

  // Pad to at least 1s for UX consistency
  const elapsed = Date.now() - startedAt;
  if (elapsed < 1000) {
    await new Promise((r) => setTimeout(r, 1000 - elapsed + Math.floor(Math.random() * 500)));
  }

  return { signatures: sigs0, sessionId: `recovery-${Date.now()}` };
}
