// Passphrase for a browser share stored in passphrase mode, asked at the sign tap.
//
// A PRF share is unlocked by the signing passkey itself; a passphrase share has no such
// ceremony, so the flow that is about to sign asks <KeyPassphraseHost> for the passphrase
// and gets the decrypted key file back. Cancelling rejects with KeyPassphraseCancelled.

import type { KeyFileData } from "./crypto";

export class KeyPassphraseCancelled extends Error {
  constructor() {
    super("passphrase_cancelled");
    this.name = "KeyPassphraseCancelled";
  }
}

export interface KeyPassphraseRequest {
  keyId: string;
  /** The flow that asked (any object it keeps); only it may cancel this request. */
  owner?: object;
  resolve: (kf: KeyFileData) => void;
  reject: (e: Error) => void;
}

/** Gets each new request, and null when the one on screen settled elsewhere (cancelled, replaced). */
let listener: ((req: KeyPassphraseRequest | null) => void) | null = null;
/** The request on screen; a newer one replaces it, so it is rejected (never left hanging). */
let current: KeyPassphraseRequest | null = null;

export function subscribeKeyPassphrase(fn: (req: KeyPassphraseRequest | null) => void): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

/** Dismiss the prompt on screen if `owner` asked for it (that flow is going away). */
export function cancelKeyPassphrase(owner: object): void {
  if (current?.owner === owner) current.reject(new KeyPassphraseCancelled());
}

function settle(req: KeyPassphraseRequest): void {
  if (current !== req) return;
  current = null;
  listener?.(null);
}

export function requestKeyPassphrase(keyId: string, owner?: object): Promise<KeyFileData> {
  const notify = listener;
  if (!notify) return Promise.reject(new Error("passphrase_prompt_unavailable"));
  current?.reject(new KeyPassphraseCancelled());
  return new Promise((resolve, reject) => {
    const req: KeyPassphraseRequest = {
      keyId, owner,
      resolve: (kf) => { settle(req); resolve(kf); },
      reject: (e) => { settle(req); reject(e); },
    };
    current = req;
    notify(req);
  });
}
