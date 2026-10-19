// What an EVM history row really is: approval, revoke, swap or a contract call. Pure: the calldata is read by the
// review's decoder (evm-calldata-legs.ts), the caller supplies the rows and the wallet's known assets.

import { getAddress } from "ethers";
import type { Asset, Transaction, TxKind } from "../shared/types";
import { evmLegs } from "./review/evm-calldata-legs";

export interface ClassifyCtx {
  address: string;
  /** The chain's assets as the wallet lists them (symbol / decimals by contract). */
  assets: Asset[];
}

const SEL_APPROVE = "095ea7b3";
const SEL_SET_APPROVAL_FOR_ALL = "a22cb465";

/** Raw token units as the history rows show them: grouped integer part, trimmed fraction. */
export function fmtUnits(raw: bigint, decimals: number): string {
  const str = raw.toString().padStart(decimals + 1, "0");
  const int = str.slice(0, str.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = str.slice(str.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

function checksum(addr: string): string {
  try { return getAddress(addr); } catch { return addr; }
}

/** Blockscout's `method` is a decoded name ("withdraw") or a hex selector; only a name is worth showing. */
export function readableMethod(method: string | undefined): string | undefined {
  return method && /^[A-Za-z_][A-Za-z0-9_]*$/.test(method) ? method : undefined;
}

/** Approval / revoke / contract call from one native-list row (it carries the calldata); null = plain row. */
export function classifyNativeTx(tx: Transaction, ctx: ClassifyCtx): TxKind | null {
  const data = (tx.input ?? "").replace(/^0x/, "").toLowerCase();
  if (data.length === 0 || tx.isDeployment || !tx.to) return null;
  let value = 0n;
  try { value = BigInt(tx.value || "0"); } catch { /* keep 0 */ }
  const legs = evmLegs(tx.from, tx.to, value, data);
  const selector = data.slice(0, 8);

  const approval = legs.find((l) => l.kind === "approval");
  if (approval && approval.kind === "approval") {
    if (approval.standard === "erc721_all") return { type: "approveNfts", operator: checksum(approval.spender) };
    const contract = approval.asset.contract?.toLowerCase() ?? "";
    const known = ctx.assets.find((a) => a.contractAddress?.toLowerCase() === contract);
    const symbol = known?.symbol ?? (contract === tx.to.toLowerCase() ? tx.toName : undefined) ?? "token";
    const spender = checksum(approval.spender);
    if (approval.amount === 0n && selector === SEL_APPROVE) return { type: "revoke", symbol, spender };
    // increaseAllowance etc. add to an allowance the bytes do not show: no amount claimed.
    const exact = approval.amount !== "ALL" && !!known;
    const unlimited = approval.amount === "ALL" && selector === SEL_APPROVE;
    return {
      type: "approve",
      symbol,
      spender,
      unlimited,
      amount: exact ? fmtUnits(approval.amount as bigint, known!.decimals) : null,
    };
  }
  if (selector === SEL_SET_APPROVAL_FOR_ALL && legs.some((l) => l.kind === "contract_call")) {
    return { type: "revokeNfts", operator: checksum("0x" + data.slice(32, 72)) };
  }
  if (legs.some((l) => l.kind === "contract_call" || l.kind === "unknown")) {
    return { type: "call", method: readableMethod(tx.method) };
  }
  return null;
}

interface Leg { key: string; symbol: string; amount: string }

/** Outgoing and incoming assets of one hash: native value plus token transfers. */
function swapLegs(native: Transaction | undefined, tokens: Transaction[]): { out?: Leg; inn?: Leg } {
  const legs: { dir: "in" | "out"; leg: Leg }[] = [];
  if (native && native.value !== "0" && (native.direction === "out" || native.direction === "in")) {
    legs.push({ dir: native.direction, leg: { key: "native", symbol: native.symbol, amount: native.formatted } });
  }
  for (const t of tokens) {
    if (t.direction === "self") continue;
    legs.push({ dir: t.direction, leg: { key: t.tokenContract ?? t.symbol, symbol: t.symbol, amount: t.formatted } });
  }
  const out = legs.find((l) => l.dir === "out")?.leg;
  const inn = legs.find((l) => l.dir === "in" && l.leg.key !== out?.key)?.leg;
  return { out, inn };
}

/**
 * One row per hash from the native list (carries calldata) and the token-transfer list. Token transfers win over the
 * 0 ETH native row as before; approvals, swaps and contract calls get a `kind`. Transfers of tokens the wallet does
 * not list (airdrop spam, an aToken burn) are dropped and never count as a swap leg.
 */
export function mergeEvmActivity(nativeTxs: Transaction[], tokenTxs: Transaction[], ctx: ClassifyCtx): Transaction[] {
  const listed = new Set(ctx.assets.map((a) => a.contractAddress?.toLowerCase()).filter(Boolean));
  const nativeBy = new Map(nativeTxs.map((t) => [t.hash, t]));
  const tokensBy = new Map<string, Transaction[]>();
  for (const t of tokenTxs) tokensBy.set(t.hash, [...(tokensBy.get(t.hash) ?? []), t]);

  const rows: Transaction[] = [];
  for (const hash of new Set([...tokensBy.keys(), ...nativeBy.keys()])) {
    const native = nativeBy.get(hash);
    const tokens = tokensBy.get(hash) ?? [];
    const kind = native ? classifyNativeTx(native, ctx) : null;
    if (native && kind && kind.type !== "call") { rows.push({ ...native, kind }); continue; }

    // Only listed tokens make a swap: an Aave withdraw burns the unlisted aToken and pays USDC in, which is a receive.
    // A 0-unit transfer of a real token is address poisoning (a lookalike party to copy later): never a row.
    const shown = tokens.filter((t) => t.tokenContract && listed.has(t.tokenContract) && t.value !== "0");
    const { out, inn } = swapLegs(native, shown);
    if (out && inn) {
      const base = native ?? shown[0];
      rows.push({ ...base, kind: { type: "swap", out: { symbol: out.symbol, amount: out.amount }, in: { symbol: inn.symbol, amount: inn.amount } } });
      continue;
    }
    if (shown.length > 0) rows.push(shown[0]);
    else if (native) rows.push(kind ? { ...native, kind } : native);
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
}

/** Kinds for a native-asset history page (token detail, account preview). */
export function withNativeKinds(txs: Transaction[], ctx: ClassifyCtx): Transaction[] {
  return txs.map((tx) => {
    if (tx.kind) return tx;
    const kind = classifyNativeTx(tx, ctx);
    return kind ? { ...tx, kind } : tx;
  });
}
