// Restore: a v2 passkey envelope that does not open is swapped ONCE for the password backup, which is the
// password-sealed stored share a refresh wrote (mode "passphrase"), and that one opens with the backup password.
import { describe, expect, mock, test } from "bun:test";
import type { KeyFileData } from "../crypto";

const g = globalThis as Record<string, unknown>;
g.window ??= { addEventListener() {}, removeEventListener() {}, location: { href: "" } };
g.document ??= { documentElement: { setAttribute() {}, removeAttribute() {} } };
const memStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: () => null, length: 0 }; };
g.sessionStorage ??= memStore();
g.localStorage ??= memStore();
const KS = "ks-swap";
const keyFile: KeyFileData = { id: KS, peer: 0, share: "AAEC,AwQF", publicKey: "02abcd", eddsaShare: "", eddsaPublicKey: "", type: "email", shareGeneration: 2 };

const { sealStoredShare } = await import("../keystore");
const pwSealed = await sealStoredShare(KS, keyFile, { passphrase: "correct horse battery" });
const calls: Array<{ passwordOnly?: boolean }> = [];
const real = await import("../escrow-download");
mock.module("../escrow-download", () => ({
  ...real,
  downloadEscrow: async (_id: string, opts: { passwordOnly?: boolean } = {}) => {
    calls.push(opts);
    return { encryptedData: pwSealed, source: "password", shareGeneration: 2, current: true };
  },
}));
g.fetch = async () => new Response(JSON.stringify({ keys: [{ id: KS, publicKey: "02abcd" }] }), { status: 200 });

const { sealEnvelopeV2 } = await import("../escrow-envelope-v2");
const { escrowPublicKey, escrowSecretFromPrf } = await import("../passkey-escrow-key");
const { b64 } = await import("./move-codec");
const { openPasskeyBackupOrPassword } = await import("./move-restore");
const { isPasswordBackup, openPasswordBackup } = await import("./move-restore-backup");

describe("restore password swap", () => {
  test("v2 fails -> swapped to passphrase StoredShare opens", async () => {
    const theirs = await escrowSecretFromPrf(new Uint8Array(32).fill(5));
    const mine = await escrowSecretFromPrf(new Uint8Array(32).fill(6)); // not the key it was sealed to
    const v2 = await sealEnvelopeV2({ keyShareId: KS, credentialId: "cred", generation: 2, recipientKey: b64(escrowPublicKey(theirs)), keyFile });
    const prfKey = {} as CryptoKey;
    const out = await openPasskeyBackupOrPassword(KS, { encryptedData: v2, source: "passkey", shareGeneration: 2, current: true, escrowSecret: mine, credentialId: "cred", prfKey });
    expect(out.keyFile).toBeNull();
    expect(calls).toEqual([{ passwordOnly: true }]);
    expect(mine.every((b) => b === 0)).toBe(true); // escrow secret wiped
    expect(out.blob.prfKey).toBe(prfKey); // kept for saving the copy locally
    const parsed = JSON.parse(out.blob.encryptedData);
    expect(isPasswordBackup(parsed)).toBe(true);
    expect((await openPasswordBackup(KS, parsed, "correct horse battery")).share).toBe(keyFile.share);
    await expect(openPasswordBackup(KS, parsed, "wrong")).rejects.toThrow();
    await expect(openPasswordBackup("other-wallet", parsed, "correct horse battery")).rejects.toThrow();
  });
});

describe("backup status", () => {
  test("slotNeeded alone turns the new backup on", async () => {
    const { backedUpFrom } = await import("./move-new-device");
    const base = { hasBackup: false, mode: null, shareGeneration: 0, current: true, passkeys: 0, password: false };
    expect(backedUpFrom(base)).toBe(false);
    expect(backedUpFrom({ ...base, slotNeeded: true })).toBe(true);
    expect(backedUpFrom(null)).toBe(false);
  });
});
