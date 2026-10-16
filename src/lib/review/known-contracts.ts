// Names for well-known EVM contracts that are not tokens (spenders, routers). Tokens get their name
// from the chain asset list; Solana programs from KNOWN_PROGRAMS. Keep this list short and exact:
// a name is a hint next to the full address, never a substitute for it.

const EVM_CONTRACTS: Record<string, string> = {
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap Permit2",
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": "Uniswap Universal Router",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": "Uniswap Universal Router",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap Router 02",
  "0x111111125421ca6dc452d289314280a0f8842a65": "1inch Router v6",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x Exchange Proxy",
};

export function knownEvmContract(address: string): string | undefined {
  return EVM_CONTRACTS[address.toLowerCase()];
}
