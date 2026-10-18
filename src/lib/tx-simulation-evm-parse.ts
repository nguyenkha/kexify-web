// Pure parser for the standard `eth_simulateV1` response (with traceTransfers: true).
// No network here, so it is unit-tested against recorded fixtures and reusable outside the browser.

/** ERC-20 Transfer(address,address,uint256) topic. */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** traceTransfers reports native-value moves as Transfer logs from this pseudo address (EIP / geth convention). */
export const NATIVE_TRANSFER_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export interface EvmSimLog {
  address: string;
  topics?: string[];
  data?: string;
}

export interface EvmSimCall {
  status?: string;
  logs?: EvmSimLog[];
  gasUsed?: string;
  error?: { message?: string };
}

export interface EvmSimBlock {
  calls?: EvmSimCall[];
}

/** Net change of one asset for the user: contract null = native coin. */
export interface EvmNetDelta {
  contractAddress: string | null;
  delta: bigint; // positive = received, negative = sent
}

export interface EvmSimParsed {
  reverted: boolean;
  deltas: EvmNetDelta[];
}

function topicToAddress(topic: string): string {
  return ("0x" + topic.slice(-40)).toLowerCase();
}

/**
 * Sum every Transfer log (native pseudo-logs and ERC-20) that touches `user` into one net delta per asset.
 * Assets that net to zero are dropped. A reverted call yields `reverted: true` and no deltas.
 * Logs with a non-standard shape (ERC-721 has the token id in topic 3 and no data) are skipped.
 */
export function parseEthSimulateV1(result: unknown, user: string): EvmSimParsed {
  const blocks = Array.isArray(result) ? (result as EvmSimBlock[]) : [];
  const me = user.toLowerCase();
  const net = new Map<string, bigint>();
  let reverted = false;

  for (const block of blocks) {
    for (const call of block.calls ?? []) {
      if (call.status !== undefined && BigInt(call.status) !== 1n) {
        reverted = true;
        continue;
      }
      for (const log of call.logs ?? []) {
        const topics = log.topics ?? [];
        if (topics[0]?.toLowerCase() !== TRANSFER_TOPIC || topics.length !== 3) continue;
        if (!log.data || log.data === "0x") continue;
        const from = topicToAddress(topics[1]);
        const to = topicToAddress(topics[2]);
        if (from !== me && to !== me) continue;
        let amount: bigint;
        try {
          amount = BigInt(log.data);
        } catch {
          continue;
        }
        const key = log.address.toLowerCase();
        let d = net.get(key) ?? 0n;
        if (from === me) d -= amount;
        if (to === me) d += amount;
        net.set(key, d);
      }
    }
  }

  if (reverted) return { reverted: true, deltas: [] };
  const deltas: EvmNetDelta[] = [];
  for (const [addr, delta] of net) {
    if (delta === 0n) continue;
    deltas.push({ contractAddress: addr === NATIVE_TRANSFER_ADDRESS ? null : addr, delta });
  }
  // Native first, then tokens in log order
  deltas.sort((a, b) => (a.contractAddress === null ? -1 : b.contractAddress === null ? 1 : 0));
  return { reverted: false, deltas };
}

/** Base units -> decimal string without trailing zeros (no rounding). */
export function formatBaseUnits(raw: bigint, decimals: number): string {
  const abs = raw < 0n ? -raw : raw;
  if (decimals <= 0) return abs.toString();
  const s = abs.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Decode an ABI `string` return (or legacy bytes32) from symbol(). Returns null when it cannot. */
export function decodeAbiString(hex: string | undefined): string | null {
  if (!hex || hex === "0x") return null;
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  try {
    let bytes: string;
    if (h.length === 64) {
      bytes = h.replace(/(00)+$/, ""); // bytes32 symbol (e.g. MKR)
    } else {
      const offset = Number(BigInt("0x" + h.slice(0, 64))) * 2;
      const len = Number(BigInt("0x" + h.slice(offset, offset + 64))) * 2;
      if (len === 0 || len > 128) return null;
      bytes = h.slice(offset + 64, offset + 64 + len);
    }
    const arr = new Uint8Array(bytes.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
    const s = new TextDecoder().decode(arr).replace(/[^\x20-\x7e]/g, "").trim();
    return s ? s.slice(0, 16) : null;
  } catch {
    return null;
  }
}
