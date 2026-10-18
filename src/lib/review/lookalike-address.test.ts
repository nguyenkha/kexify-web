import { describe, expect, test } from "bun:test";
import { buildSendReview, findLookalike } from ".";
import { addressBody } from "./lookalike-address";

const ALICE = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
// Same first and last 4 hex characters, different middle (a poisoning address).
const FAKE = "0x3fC9000000000000000000000000000000007FAD";
/** `addr` with everything between its first `head` and last 4 characters replaced. */
const poison = (addr: string, head: number) => addr.slice(0, head) + "2".repeat(addr.length - head - 4) + addr.slice(-4);
const known = [{ address: ALICE, name: "Alice" }];

describe("findLookalike", () => {
  test("same ends, different middle", () => expect(findLookalike(FAKE, known)).toEqual(known[0]));
  test("case does not matter", () => expect(findLookalike(FAKE.toLowerCase(), known)?.name).toBe("Alice"));
  test("exact match is known, not a lookalike", () => {
    expect(findLookalike(ALICE.toLowerCase(), known)).toBeNull();
    expect(findLookalike(FAKE, [...known, { address: FAKE }])).toBeNull();
  });
  test("only one end matching is not a lookalike", () => {
    expect(findLookalike("0x3fC9000000000000000000000000000000001234", known)).toBeNull();
    expect(findLookalike("0x1234000000000000000000000000000000007FAD", known)).toBeNull();
  });
  test("no known addresses", () => expect(findLookalike(FAKE, [])).toBeNull());
  test("the shared bech32 prefix does not count as a match", () => {
    const own = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    expect(addressBody(own)).toBe("ar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    expect(findLookalike("bc1qxxxx00000000000000000000000000000f5mdq", [{ address: own }])).toBeNull();
    expect(findLookalike("bc1qar0s00000000000000000000000000000f5mdq", [{ address: own }])).toEqual({ address: own });
  });
  test("base58 chains (TRON) and scheme prefixes (BCH)", () => {
    const tron = "TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL";
    expect(findLookalike(poison(tron, 4), [{ address: tron }])).toEqual({ address: tron });
    const bch = "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a";
    expect(findLookalike(poison(bch, 16), [{ address: bch }])).toEqual({ address: bch });
    expect(findLookalike(poison(bch, 16).replace("bitcoincash:", ""), [{ address: bch }])).toEqual({ address: bch });
  });
  test("short strings are never judged", () => expect(findLookalike("0x3fC97FAD", [{ address: "0x3fC9117FAD" }])).toBeNull());
});

describe("send review", () => {
  const base = {
    asset: { symbol: "ETH", decimals: 18, isNative: true }, amount: "1", from: { address: "0x8f3C2b6E00000000000000000000000000E1F2" },
    fee: null, prices: { ETH: 3000 },
  };
  test("lookalike replaces the first-time warning and names the known address", () => {
    const m = buildSendReview({ ...base, to: FAKE, firstTimeRecipient: true, knownAddresses: known });
    expect(m.warnings.map((w) => w.code)).toEqual(["lookalikeAddress"]);
    expect(m.warnings[0]).toMatchObject({ tone: "danger", blocks: false, params: { known: "Alice (0x3fC9…7FAD)" } });
  });
  test("an unnamed known address shows only its short form", () => {
    const m = buildSendReview({ ...base, to: FAKE, knownAddresses: [{ address: ALICE }] });
    expect(m.warnings[0].params).toEqual({ known: "0x3fC9…7FAD" });
  });
  test("a real first-time address keeps the mild warning", () => {
    const m = buildSendReview({ ...base, to: "0x1111000000000000000000000000000000002222", firstTimeRecipient: true, knownAddresses: known });
    expect(m.warnings.map((w) => w.code)).toEqual(["firstTimeRecipient"]);
  });
});
