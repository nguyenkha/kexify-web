// Order of the assets inside an account section on Home: native first, then tokens by USD value (desc),
// priced-less tokens next, zero balances last. Stable: ties keep the incoming order.

export interface OrderableToken { formatted: string; usd: number | null }

export function orderTokens<T extends OrderableToken>(tokens: T[]): T[] {
  const rank = (t: T) => (parseFloat(t.formatted) > 0 ? 0 : 1);
  return tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || (b.t.usd ?? 0) - (a.t.usd ?? 0) || a.i - b.i)
    .map(({ t }) => t);
}
