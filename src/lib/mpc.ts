import { initCbMpc, NID_secp256k1, NID_ED25519 } from "cb-mpc";
import i18n from "i18next"; // singleton, initialised by src/i18n/i18n.ts
import type { CbMpc, DataTransport, Ecdsa2pKeyHandle, EcKey2pHandle } from "cb-mpc";
import { isRecoveryMode, performLocalMpcSign } from "./recovery";
import { apiUrl } from "./apiBase";
import cbmpcWasmUrl from "cb-mpc/cbmpc.wasm?url";
import { clientKeys, freeClientKeyHandles, type ClientKeyHandles } from "./client-key-cache";
import { sharePartsFromString, wipe } from "./secret-bytes";
import { noteUnlockedShare } from "./address-book-kek";
import { signSessionStarted, signSessionFinished, cancelOpenSignSession, cancelStaleSignSession, openSignSessionId } from "./sign-session-cancel";

/** Policy-blocked tx parts that have their own user-facing message (send.policyBlockedLeg.*). */
const POLICY_BLOCKED_LEGS = ["approval", "account_control", "value_message", "unknown", "fee"];

export { NID_secp256k1, NID_ED25519 };
export type { CbMpc, Ecdsa2pKeyHandle, EcKey2pHandle };

// ── Singleton MPC instance ──

let mpcInstance: CbMpc | null = null;
let mpcPromise: Promise<CbMpc> | null = null;

export async function getMpcInstance(): Promise<CbMpc> {
  if (!mpcInstance) {
    if (!mpcPromise) {
      // Import Emscripten glue and wrap factory with locateFile override.
      // Vite's dev server can't resolve the relative paths that Emscripten
      // uses internally, so we point it to Vite-resolved URLs explicitly.
      // @ts-expect-error -- cb-mpc has no type declarations
      const mod = await import("cb-mpc/cbmpc.js");
      const rawFactory = mod.default || mod.createCbMpc || mod;
      const factory = (opts?: Record<string, unknown>) =>
        rawFactory({
          ...opts,
          locateFile: (path: string) =>
            path.endsWith(".wasm") ? cbmpcWasmUrl : path,
        });
      mpcPromise = initCbMpc(factory as unknown as Parameters<typeof initCbMpc>[0]);
    }
    mpcInstance = await mpcPromise;
  }
  return mpcInstance;
}

// ── In-memory key handle cache (lost on page reload; freed when idle, see client-key-cache.ts) ──

export { clientKeys, type ClientKeyHandles };

/**
 * Placeholder share of a key file whose browser share is still PRF-encrypted: it is
 * decrypted by the passkey assertion that authorizes the signature (one tap).
 */
export const DEFERRED_PRF_SHARE = "prf-deferred";

/** Keys whose share will be unlocked by the next sign assertion. */
export const deferredPrfKeys = new Set<string>();

/**
 * Restore key handles from serialized data (stored in key file or browser storage).
 * No-op if already in memory.
 */
export async function restoreKeyHandles(keyId: string, shareData: string, eddsaShareData?: string): Promise<void> {
  // Address book sync KEK (address-book-kek.ts), also when the handle is already cached (e.g. after a re-login).
  if (shareData !== DEFERRED_PRF_SHARE) noteUnlockedShare(keyId, shareData);
  if (clientKeys.has(keyId)) return;
  if (shareData === DEFERRED_PRF_SHARE) {
    deferredPrfKeys.add(keyId);
    return;
  }

  const ecdsaParts = sharePartsFromString(shareData);
  let eddsaParts: Uint8Array[];
  try {
    eddsaParts = sharePartsFromString(eddsaShareData ?? "");
  } catch (err) {
    wipe(ecdsaParts);
    throw err;
  }
  await restoreKeyHandlesFromParts(keyId, ecdsaParts, eddsaParts);
}

/**
 * Build the handles straight from decoded share parts (no share string), then wipe the parts.
 * cb-mpc copies them into WASM memory and zeroes that copy itself.
 */
export async function restoreKeyHandlesFromParts(keyId: string, ecdsaParts: Uint8Array[], eddsaParts: Uint8Array[]): Promise<void> {
  try {
    if (clientKeys.has(keyId)) return;
    const mpc = await getMpcInstance();
    const entry: ClientKeyHandles = { mpc };
    try {
      if (ecdsaParts.length) entry.ecdsa = mpc.deserializeEcdsa2p(ecdsaParts);
      if (eddsaParts.length) entry.eddsa = mpc.deserializeEcKey2p(eddsaParts);
    } catch (err) {
      freeClientKeyHandles(entry);
      throw err;
    }
    clientKeys.set(keyId, entry);
  } finally {
    wipe(ecdsaParts, eddsaParts);
  }
}

/** Remove and free a key handle (call after signing is done or on dialog close). */
export function clearClientKey(keyId: string): void {
  clientKeys.delete(keyId);
  deferredPrfKeys.delete(keyId);
}

/** One passkey tap bound to this /sign/init (key + digest list); unlocks a deferred share too. */
async function signTicketHeaders(keyId: string, initPayload: Record<string, unknown>, digests: string[]): Promise<Record<string, string>> {
  const { authorizeSign } = await import("./sign-passkey-authorization");
  const ticket = await authorizeSign(keyId, String(initPayload.id ?? keyId), digests);
  return { "x-passkey-token": ticket };
}

// ── Helpers ──

export function toBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

export function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256(message: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

// ── HTTP Transport ──

/** receiveAll result for cb-mpc: a failed receive makes the whole call an error status (non-array), never a throw. */
export function allOrFailure(msgs: Uint8Array[]): Uint8Array[] {
  return msgs.every((m) => m instanceof Uint8Array) ? msgs : (null as unknown as Uint8Array[]);
}

const PARTY_NAMES: [string, string] = ["client", "server"];

/**
 * Create a DataTransport that bridges cb-mpc's send/receive to HTTP.
 *
 * Each transport.send() POSTs a message to the server and buffers the response.
 * The subsequent transport.receive() returns the buffered response.
 *
 * First send goes to initUrl, subsequent sends go to stepUrl.
 */
export function createHttpTransport(opts: {
  initUrl: string;
  stepUrl: string;
  initExtra?: Record<string, unknown>;
  headers: Record<string, string>;
  onStep?: (step: number) => void;
  /** The init answered with this session id. */
  onSession?: (sessionId: string) => void;
  /** Init answered 409 SESSION_ACTIVE (another operation in progress): true = the cause was cleared, send the init once more. */
  retryOn409?: () => Promise<boolean>;
}): { transport: DataTransport; getSessionId: () => string; getServerResult: () => Record<string, unknown> | null; getError: () => Error | null; transportFailed: Promise<never> } {
  let sessionId = "";
  let inbox: Uint8Array | null = null;
  let isFirst = true;
  let serverResult: Record<string, unknown> | null = null;
  let transportError: Error | null = null;
  let rejectTransport: ((err: Error) => void) | null = null;
  let stepCount = 0;
  const transportFailed = new Promise<never>((_resolve, reject) => {
    rejectTransport = reject;
  });
  // Prevent unhandled rejection when transportFailed rejects outside of Promise.race
  transportFailed.catch(() => {});

  // cb-mpc's async bridge has no rejection path: a callback that throws leaves the WASM call suspended forever
  // (and its key handle pinned). So a failed send (server error, network, bad JSON) is reported as a non-zero
  // status, and every later receive as a failure, which makes the protocol unwind; the error itself reaches the
  // caller through transportFailed.
  let sendFailed = false;

  const transport: DataTransport = {
    send: async (_receiver, message) => {
     try {
      // Copy — WASM memory views may be invalidated after return
      const msgCopy = new Uint8Array(message);
      const url = isFirst ? opts.initUrl : opts.stepUrl;
      const body = isFirst
        ? { ...opts.initExtra, message: toBase64(msgCopy) }
        : { sessionId, message: toBase64(msgCopy) };

      const post = () => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...opts.headers },
        body: JSON.stringify(body),
      });
      let res = await post();
      let data = await res.json();
      // SESSION_ACTIVE is refused before the passkey ticket is used, so the same init can be sent again.
      if (isFirst && res.status === 409 && data?.code === "SESSION_ACTIVE" && opts.retryOn409 && await opts.retryOn409()) {
        res = await post();
        data = await res.json();
      }
      if (data.error) {
        // A policy block names the part of the tx it refused; show that instead of the generic text.
        const leg = typeof data.blockedLeg === "string" && POLICY_BLOCKED_LEGS.includes(data.blockedLeg) ? data.blockedLeg : null;
        // BTC/LTC chain binding (server looks up each input on both chains).
        const chainCode = data.code === "CHAIN_MISMATCH" ? "mismatch" : data.code === "CHAIN_LOOKUP_UNAVAILABLE" ? "unavailable" : null;
        transportError = new Error(leg ? i18n.t(`send.policyBlockedLeg.${leg}`)
          : chainCode ? i18n.t(`send.chainBinding.${chainCode}`)
          : data.error);
        // Structured fields for the send error mapper (send/send-error.ts).
        Object.assign(transportError, {
          status: res.status,
          code: typeof data.code === "string" ? data.code : undefined,
          blockedLeg: typeof data.blockedLeg === "string" ? data.blockedLeg : undefined,
        });
        throw transportError;
      }

      if (isFirst) {
        sessionId = data.sessionId;
        isFirst = false;
        if (sessionId && !data.done) opts.onSession?.(sessionId);
      }
      stepCount++;
      opts.onStep?.(stepCount);

      if (data.done) {
        serverResult = data;
        // No more messages — protocol will complete on our side too (supports both single & batch)
        inbox = null;
      } else {
        inbox = data.message ? fromBase64(data.message) : null;
      }

      return 0;
     } catch (err) {
      transportError ??= err instanceof Error ? err : new Error(String(err));
      rejectTransport?.(transportError);
      sendFailed = true;
      return -1;
     }
    },

    receive: async (_sender) => {
      // Not a Uint8Array = the bridge returns an error status (see sendFailed above).
      if (sendFailed) return null as unknown as Uint8Array;
      if (inbox) {
        const msg = inbox;
        inbox = null;
        return msg;
      }
      // If server is done, return empty (protocol should also be finishing)
      return new Uint8Array(0);
    },

    receiveAll: async (senders) => allOrFailure(await Promise.all(senders.map((s) => transport.receive(s)))),
  };

  return {
    transport,
    getSessionId: () => sessionId,
    getServerResult: () => serverResult,
    getError: () => transportError,
    transportFailed,
  };
}

// ── MPC Signing ──

export interface MpcSignResult {
  signature: Uint8Array;
  sessionId: string;
}

export interface BatchMpcSignResult {
  signatures: Uint8Array[];
  sessionId: string;
}

/**
 * Run the MPC signing protocol.
 * Requires the key handle to be in the clientKeys cache; it stays pinned (not freed) for the run.
 */
export async function performMpcSign(opts: Parameters<typeof runMpcSign>[0]): Promise<MpcSignResult> {
  clientKeys.pin(opts.keyId);
  const before = openSignSessionId();
  try {
    const result = await runMpcSign(opts);
    signSessionFinished(result.sessionId);
    return result;
  } catch (err) {
    // Only the session this run started (another sign running here keeps its own): the server frees the
    // account now, not after 30 s idle.
    if (openSignSessionId() !== before) void cancelOpenSignSession();
    throw err;
  } finally {
    clientKeys.unpin(opts.keyId);
  }
}

async function runMpcSign(opts: {
  algorithm: "ecdsa" | "eddsa";
  keyId: string;
  hash: Uint8Array;
  initPayload: Record<string, unknown>;
  headers: Record<string, string>;
  onStep?: (step: number) => void;
}): Promise<MpcSignResult> {
  const { algorithm, keyId, hash, initPayload, headers, onStep } = opts;

  // In recovery mode, sign locally with both peers in the browser
  if (isRecoveryMode()) {
    return performLocalMpcSign({ algorithm, keyId, hash, onStep });
  }

  const ticketHeaders = await signTicketHeaders(keyId, initPayload, [toBase64(hash)]);

  const entry = clientKeys.get(keyId);
  if (!entry) {
    throw new Error("Key handle not found. Please re-create or re-import the key.");
  }

  const keyHandle = algorithm === "eddsa" ? entry.eddsa : entry.ecdsa;
  if (!keyHandle) {
    throw new Error(`No ${algorithm} key handle available`);
  }

  const mpc = entry.mpc;

  // For ECDSA, both parties must use the same session ID
  const sigSessionId = new Uint8Array(32);
  crypto.getRandomValues(sigSessionId);

  const { transport, getSessionId, getServerResult, getError, transportFailed } = createHttpTransport({
    initUrl: apiUrl("/api/sign/init"),
    stepUrl: apiUrl("/api/sign/step"),
    initExtra: {
      ...initPayload,
      data: toBase64(hash),
      ...(algorithm === "ecdsa" ? { sigSessionId: toBase64(sigSessionId) } : {}),
    },
    headers: { ...headers, ...ticketHeaders },
    onStep,
    onSession: (id) => signSessionStarted(id, headers),
    retryOn409: cancelStaleSignSession,
  });

  const startedAt = Date.now();

  let sigRaw: Uint8Array;

  // Race the MPC protocol against transport errors — WASM may hang if the
  // server rejects (e.g. policy block) because it swallows the send() throw.
  const mpcPromise = (async () => {
    if (algorithm === "eddsa") {
      return mpc.schnorr2pEddsaSign(
        transport, 0, PARTY_NAMES, keyHandle as EcKey2pHandle, hash,
      );
    } else {
      const sigs = await mpc.ecdsa2pSign(
        transport, 0, PARTY_NAMES, keyHandle as Ecdsa2pKeyHandle, sigSessionId, [hash],
      );
      return sigs[0].length > 0 ? sigs[0] : new Uint8Array(0);
    }
  })();

  // A transport error ends the race while WASM may still be in the protocol: the handle stays
  // pinned (not freed) until that run settles too.
  clientKeys.pin(keyId);
  mpcPromise.then(() => clientKeys.unpin(keyId), () => clientKeys.unpin(keyId));

  try {
    sigRaw = await Promise.race([mpcPromise, transportFailed]);
  } catch (err) {
    const transportErr = getError();
    if (transportErr) throw transportErr;
    throw err;
  }

  // If client didn't get the signature, check server result
  if (sigRaw.length === 0) {
    const sr = getServerResult();
    if (sr?.signature) {
      sigRaw = fromBase64(sr.signature as string);
    }
  }

  if (!sigRaw || sigRaw.length === 0) {
    throw new Error("No signature available");
  }

  // Pad fast signing to at least 1s for smoother UX
  const elapsed = Date.now() - startedAt;
  if (elapsed < 1000) {
    await new Promise((r) =>
      setTimeout(r, 1000 - elapsed + Math.floor(Math.random() * 500)),
    );
  }

  return { signature: sigRaw, sessionId: getSessionId() };
}

/**
 * Batch MPC signing — sign multiple hashes in a single MPC session.
 * Used for UTXO chains (BTC/BCH/LTC) where each input needs a separate signature.
 * Only supports ECDSA (ecdsa2pSign natively accepts multiple hashes).
 */
export async function performBatchMpcSign(opts: Parameters<typeof runBatchMpcSign>[0]): Promise<BatchMpcSignResult> {
  clientKeys.pin(opts.keyId);
  const before = openSignSessionId();
  try {
    const result = await runBatchMpcSign(opts);
    signSessionFinished(result.sessionId);
    return result;
  } catch (err) {
    // Only the session this run started (another sign running here keeps its own): the server frees the
    // account now, not after 30 s idle.
    if (openSignSessionId() !== before) void cancelOpenSignSession();
    throw err;
  } finally {
    clientKeys.unpin(opts.keyId);
  }
}

async function runBatchMpcSign(opts: {
  keyId: string;
  hashes: Uint8Array[];
  initPayload: Record<string, unknown>;
  headers: Record<string, string>;
  onStep?: (step: number) => void;
}): Promise<BatchMpcSignResult> {
  const { keyId, hashes, initPayload, headers, onStep } = opts;

  if (hashes.length === 0) throw new Error("No hashes to sign");

  // Single hash — delegate to regular sign
  if (hashes.length === 1) {
    const result = await performMpcSign({
      algorithm: "ecdsa",
      keyId,
      hash: hashes[0],
      initPayload,
      headers,
      onStep,
    });
    return { signatures: [result.signature], sessionId: result.sessionId };
  }

  // In recovery mode, sign each hash locally (recovery uses separate sessions)
  if (isRecoveryMode()) {
    const { performLocalBatchMpcSign } = await import("./recovery");
    return performLocalBatchMpcSign({ keyId, hashes, onStep });
  }

  // The whole batch is one authorization: the ticket binds every digest, in order.
  const ticketHeaders = await signTicketHeaders(keyId, initPayload, hashes.map((h) => toBase64(h)));

  const entry = clientKeys.get(keyId);
  if (!entry) {
    throw new Error("Key handle not found. Please re-create or re-import the key.");
  }

  const keyHandle = entry.ecdsa;
  if (!keyHandle) {
    throw new Error("No ECDSA key handle available");
  }

  const mpc = entry.mpc;

  // Both parties must use the same session ID
  const sigSessionId = new Uint8Array(32);
  crypto.getRandomValues(sigSessionId);

  // Build hashes array for init payload
  const hashesPayload = hashes.map((h, i) => ({
    data: toBase64(h),
    inputIndex: i,
  }));

  const { transport, getSessionId, getServerResult, getError, transportFailed } = createHttpTransport({
    initUrl: apiUrl("/api/sign/init"),
    stepUrl: apiUrl("/api/sign/step"),
    initExtra: {
      ...initPayload,
      data: toBase64(hashes[0]),
      hashes: hashesPayload,
      sigSessionId: toBase64(sigSessionId),
    },
    headers: { ...headers, ...ticketHeaders },
    onStep,
    onSession: (id) => signSessionStarted(id, headers),
    retryOn409: cancelStaleSignSession,
  });

  const startedAt = Date.now();

  const mpcPromise = (async () => {
    const sigs = await mpc.ecdsa2pSign(
      transport, 0, PARTY_NAMES, keyHandle as Ecdsa2pKeyHandle, sigSessionId, hashes,
    );
    return sigs;
  })();

  let rawSigs: Uint8Array[];
  // A transport error ends the race while WASM may still be in the protocol: the handle stays
  // pinned (not freed) until that run settles too.
  clientKeys.pin(keyId);
  mpcPromise.then(() => clientKeys.unpin(keyId), () => clientKeys.unpin(keyId));

  try {
    rawSigs = await Promise.race([mpcPromise, transportFailed]);
  } catch (err) {
    const transportErr = getError();
    if (transportErr) throw transportErr;
    throw err;
  }

  // If client got empty signatures, check server result
  if (rawSigs.every((s) => s.length === 0)) {
    const sr = getServerResult();
    if (sr?.signatures) {
      rawSigs = (sr.signatures as string[]).map((s) => fromBase64(s));
    }
  }

  if (!rawSigs || rawSigs.length !== hashes.length) {
    throw new Error(`Expected ${hashes.length} signatures, got ${rawSigs?.length ?? 0}`);
  }

  for (let i = 0; i < rawSigs.length; i++) {
    if (!rawSigs[i] || rawSigs[i].length === 0) {
      throw new Error(`No signature produced for input ${i}`);
    }
  }

  // Pad fast signing to at least 1s for smoother UX
  const elapsed = Date.now() - startedAt;
  if (elapsed < 1000) {
    await new Promise((r) =>
      setTimeout(r, 1000 - elapsed + Math.floor(Math.random() * 500)),
    );
  }

  return { signatures: rawSigs, sessionId: getSessionId() };
}
