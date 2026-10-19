import { describe, expect, test } from "bun:test";
import { b64 } from "./device-move/move-codec";
import { silentRecipients } from "./backup-passkey-allow";
import { escrowPublicKey, escrowSecretFromPrf, noteEscrowPasskey, ownEscrowKeyMatches } from "./passkey-escrow-key";

const pub = async (fill: number) => escrowPublicKey(await escrowSecretFromPrf(new Uint8Array(32).fill(fill)));
const row = (credentialId: string, escrowKey: string) => ({ credentialId, name: null, escrowKey, approved: false });

describe("silent allow of this tab's own passkey", () => {
  test("only when the server's escrow key equals the one derived here", async () => {
    const mine = await pub(1);
    const other = await pub(2);
    noteEscrowPasskey("own-ok", mine);
    noteEscrowPasskey("own-pinned", mine);
    const pending = [row("own-ok", b64(mine)), row("own-pinned", b64(other)), row("never-here", b64(mine))];
    expect(silentRecipients(pending).map((r) => r.credentialId)).toEqual(["own-ok"]);
  });

  test("a mismatched, short or garbled server key never matches", async () => {
    const mine = await pub(3);
    noteEscrowPasskey("cred", mine);
    expect(ownEscrowKeyMatches("cred", b64(mine))).toBe(true);
    expect(ownEscrowKeyMatches("cred", b64(await pub(4)))).toBe(false);
    expect(ownEscrowKeyMatches("cred", b64(mine.slice(0, 31)))).toBe(false);
    expect(ownEscrowKeyMatches("cred", "%%%")).toBe(false);
    expect(ownEscrowKeyMatches("unknown", b64(mine))).toBe(false);
  });
});

describe("anonymous wallets", () => {
  test("never allow a passkey silently (password backups only)", async () => {
    const { allowOwnPasskeysSilently } = await import("./backup-passkey-allow");
    const kf = { id: "ks", peer: 0, share: "x", publicKey: "02", eddsaShare: "", eddsaPublicKey: "", type: "standalone" as const };
    expect(await allowOwnPasskeysSilently("ks", kf)).toBe(0);
  });
});
