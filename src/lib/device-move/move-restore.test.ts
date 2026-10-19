// Lost-device restore: opening the served backup (PRF, password, encrypted key file) and the backup-upload message.
import { describe, expect, test } from "bun:test";
import type { KeyFileData } from "../crypto";
import type { ServedBackup as EscrowBlob } from "./move-restore-backup";

const g = globalThis as Record<string, unknown>;
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };
const { sealStoredShare } = await import("../keystore");
const { encryptKeyFile } = await import("../crypto");
const { blobNeedsPassword, decryptRestoreBackup } = await import("./move-restore-backup");
const { backupUploadMessage } = await import("./move-signer-messages");
const { moveFingerprint } = await import("./move-qr-text");
const keystore = await import("../keystore");
const { pendingNeedsPassword } = await import("./move-pending-retry");
const { backupUploadErrorText } = await import("../escrow-download");

describe("pending copy and fingerprint", () => {
  test("pending copy: save, list, promote to the stored share, drop", () => {
    const store = new Map<string, string>();
    const prev = g.localStorage;
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; },
    };
    try {
      const sealed = JSON.stringify({ keyId: KS, mode: "prf", iv: "a", ciphertext: "b", meta: { publicKey: "04", storedAt: "x" } });
      keystore.savePendingShare({ keyId: KS, sealed, target: 3 });
      expect(keystore.listPendingShares()).toEqual([{ keyId: KS, sealed, target: 3 }]);
      expect(pendingNeedsPassword(KS)).toBe(false); // a PRF copy: one passkey tap
      expect(keystore.hasKeyShare(KS)).toBe(false);
      expect(keystore.promotePendingShare(KS)).toBe(true);
      expect(keystore.hasKeyShare(KS)).toBe(true);
      expect(keystore.getPendingShare(KS)).toBeNull();
      keystore.savePendingShare({ keyId: KS, sealed, target: 4 });
      keystore.dropPendingShare(KS);
      expect(keystore.listPendingShares()).toEqual([]);
    } finally {
      g.localStorage = prev;
    }
  });

  test("no-camera code = first 12 hex of sha256(dev|eph|nonce), upper case (API formula)", async () => {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("DEV|EPH|" + "ab".repeat(32))));
    const want = Array.from(h, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 12).toUpperCase();
    expect(await moveFingerprint("DEV", "EPH", "ab".repeat(32))).toBe(want);
  });

  test("pending copy verdict: promote only at the target with our signer active (iOS rule)", async () => {
    const { pendingVerdict } = await import("./move-new-device");
    expect(pendingVerdict(3, 3, null, true)).toBe("promote");
    expect(pendingVerdict(3, 3, null, false)).toBe("drop"); // another device committed
    expect(pendingVerdict(3, 4, null, true)).toBe("drop"); // moved on past us
    expect(pendingVerdict(3, 2, null, true)).toBe("drop"); // never committed, nothing in flight
    expect(pendingVerdict(3, 2, 3, true)).toBe("retry"); // still in flight
    expect(pendingVerdict(3, undefined, null, true)).toBe("retry"); // older server: no answer
  });

  test("settle at the target without a local signer record: try later, keep the pending copy", async () => {
    const store = new Map<string, string>();
    const prevLs = g.localStorage, prevFetch = globalThis.fetch;
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k), key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; },
    };
    let signersAsked = false;
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes("/signers")) signersAsked = true;
      return new Response(JSON.stringify(String(url).includes("/backup/status")
        ? { hasBackup: true, mode: "prf", shareGeneration: 3, current: true, passkeys: 1, password: false, walletGeneration: 3, refreshPending: null }
        : { signers: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      const { settlePendingShare } = await import("./move-new-device");
      const NO_REC = "99999999-0000-4000-8000-000000000000"; // no device signer record for this wallet (other files use KS)
      keystore.savePendingShare({ keyId: NO_REC, sealed: "{}", target: 3 });
      expect(await settlePendingShare(NO_REC)).toBeNull();
      expect(keystore.getPendingShare(NO_REC)).not.toBeNull();
      expect(signersAsked).toBe(false);
    } finally {
      g.localStorage = prevLs;
      globalThis.fetch = prevFetch;
    }
  });

  test("a cancelled or dropped passkey prompt says so (never a silent failure)", async () => {
    const { moveErrorMessage } = await import("./move-error-message");
    const t = ((k: string) => k) as never;
    expect(moveErrorMessage(new DOMException("x", "NotAllowedError"), t)).toBe("move.passkeyCancelled");
    expect(moveErrorMessage(new DOMException("x", "AbortError"), t)).toBe("move.passkeyCancelled");
    expect(moveErrorMessage(new Error("boom"), t)).toBe("move.failed");
  });

  test("backup upload refusals have their own lines", () => {
    const t = (k: string) => k;
    expect(backupUploadErrorText({ code: "SHARE_GENERATION_MISMATCH" }, t)).toBe("backup.old");
    expect(backupUploadErrorText({ code: "SIGNER_NOT_ACTIVE" }, t)).toBe("backup.fromSigner");
    expect(backupUploadErrorText({ code: "x" }, t)).toBe("");
  });
});

const KS = "11111111-2222-3333-4444-555555555555";
const file: KeyFileData = { id: KS, peer: 0, share: "c2hhcmU=", publicKey: "04ab", eddsaShare: "ZWQ=", eddsaPublicKey: "ed" };
const blob = (encryptedData: string, extra: Partial<EscrowBlob> = {}): EscrowBlob => ({ encryptedData, shareGeneration: 4, ...extra });

describe("restore backup", () => {
  test("password stored share: needs the password, wrong one fails, generation from the server", async () => {
    const b = blob(await sealStoredShare(KS, file, { passphrase: "correct horse" }));
    expect(blobNeedsPassword(b)).toBe(true);
    const out = await decryptRestoreBackup(KS, b, "correct horse");
    expect(out.share).toBe(file.share);
    expect(out.shareGeneration).toBe(4);
    await expect(decryptRestoreBackup(KS, b, "wrong")).rejects.toThrow();
  });

  test("PRF stored share opens with the assertion's PRF key only", async () => {
    const prfKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const other = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const sealed = await sealStoredShare(KS, file, { prfKey, credentialId: "cred" });
    expect(blobNeedsPassword(blob(sealed))).toBe(false);
    expect((await decryptRestoreBackup(KS, blob(sealed, { prfKey }))).eddsaShare).toBe(file.eddsaShare);
    await expect(decryptRestoreBackup(KS, blob(sealed, { prfKey: other }))).rejects.toThrow();
    await expect(decryptRestoreBackup(KS, blob(sealed))).rejects.toThrow();
  });

  test("encrypted key file and wallet id check", async () => {
    const enc = JSON.stringify(await encryptKeyFile(file, "pw-123456"));
    expect((await decryptRestoreBackup(KS, blob(enc), "pw-123456")).share).toBe(file.share);
    await expect(decryptRestoreBackup("other-wallet", blob(enc), "pw-123456")).rejects.toThrow();
  });

  test("backup upload message (api backupUploadMessage)", () => {
    expect(new TextDecoder().decode(backupUploadMessage(KS, "ab", "n1"))).toBe(`kexify-signer:v1:backup:${KS}:ab:n1`);
  });
});
