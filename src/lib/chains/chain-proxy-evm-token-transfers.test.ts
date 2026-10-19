// WalletActivity falls back to the proxy's erc20 rows when blockscout cannot be read: only listed tokens, never spam.
import { expect, test } from "bun:test";
import type { Asset } from "../../shared/types";
import baseHistory from "./fixtures/chain-proxy/base-history.json";
import { parseEvmTokenTransfers } from "./chain-proxy-evm";

const ME = "0x419a5065a29fcfc1f8088dae931f187501592b02";
const LITHO = "0xb756c679db8c1dd70060cde2e9ac63856e035d63";
const litho: Asset = { id: "l", symbol: "LITHO", name: "LITHO", decimals: 9, contractAddress: LITHO, isNative: false, iconUrl: null, chainId: "x" };

test("listed token transfers become token rows with the listed symbol / decimals and the contract", () => {
  const rows = parseEvmTokenTransfers(baseHistory as never, ME, [litho])!;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ symbol: "LITHO", formatted: "9", direction: "in", tokenContract: LITHO });
});

test("spam tokens and native transfers are not rows; unreadable answer is null", () => {
  expect(parseEvmTokenTransfers(baseHistory as never, ME, [])).toEqual([]);
  expect(parseEvmTokenTransfers({} as never, ME, [litho])).toBeNull();
});
