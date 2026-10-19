import { expect, test } from "bun:test";
import { orderTokens } from "./asset-order";

test("USD desc, unpriced after priced, zero balances last, ties keep order", () => {
  const rows = [
    { id: "zero", formatted: "0", usd: 0 },
    { id: "a", formatted: "5", usd: 5 },
    { id: "unpriced", formatted: "100", usd: null },
    { id: "big", formatted: "1", usd: 50 },
    { id: "b", formatted: "5", usd: 5 },
  ];
  expect(orderTokens(rows).map((r) => r.id)).toEqual(["big", "a", "b", "unpriced", "zero"]);
});
