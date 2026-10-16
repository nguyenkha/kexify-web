// Copy of the API policy's EVM calldata decoder (api/src/policy/evm-calldata.ts) so the review names exactly the
// legs the policy judges; kept identical by evm-calldata-legs.test.ts (same output on the same calldata). Edit both.

type Amount = bigint | "ALL";
type ApprovalStandard = "erc20" | "erc721" | "erc721_all" | "permit2" | "eip2612" | "spl";
type AssetRef = { contract: string | null };
export type Leg =
  | { kind: "transfer"; to: string; asset: AssetRef; amount: Amount }
  | { kind: "approval"; spender: string; asset: AssetRef; amount: Amount; standard: ApprovalStandard }
  | { kind: "contract_call"; to: string; selector?: string }
  | { kind: "unknown"; detail: string };
const transferLeg = (to: string, amount: Amount, contract: string | null = null): Leg => ({ kind: "transfer", to, asset: { contract }, amount });
const unknownLeg = (detail: string): Leg => ({ kind: "unknown", detail });


export const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x" + "0".repeat(40);

const SEL = {
  transfer: "a9059cbb",          // transfer(address,uint256)
  transferFrom: "23b872dd",      // transferFrom(address,address,uint256)
  approve: "095ea7b3",           // approve(address,uint256)
  increaseAllowance: "39509351", // increaseAllowance(address,uint256)
  setApprovalForAll: "a22cb465", // setApprovalForAll(address,bool)
  permit2Approve: "87517c45",    // Permit2.approve(address,address,uint160,uint48)
  permit2Single: "2b67b570",     // Permit2.permit(address,PermitSingle,bytes)
  permit2Batch: "2a2d80d1",      // Permit2.permit(address,PermitBatch,bytes)
  eip2612Permit: "d505accf",     // permit(address,address,uint256,uint256,uint8,bytes32,bytes32)
  daiPermit: "8fcbaf0c",         // permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)
  increaseApproval: "d73dd623",  // increaseApproval(address,uint256) (legacy OpenZeppelin)
  authorizeOperator: "959b8c3f", // ERC-777 authorizeOperator(address)
  transferAndCall: "4000aea0",   // ERC-677 transferAndCall(address,uint256,bytes)
  erc777Send: "9bd9bbc6",        // ERC-777 send(address,uint256,bytes)
  nftSafeTransfer: "42842e0e",   // ERC-721 safeTransferFrom(address,address,uint256)
  nftSafeTransferData: "b88d4fde", // ERC-721 safeTransferFrom(address,address,uint256,bytes)
  erc1155Transfer: "f242432a",   // ERC-1155 safeTransferFrom(address,address,uint256,uint256,bytes)
  erc1155Batch: "2eb2c2d6",      // ERC-1155 safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)
} as const;

function word(data: string, i: number): string | null {
  const w = data.slice(8 + i * 64, 8 + (i + 1) * 64);
  return w.length === 64 ? w : null;
}

function addrWord(data: string, i: number): string | null {
  const w = word(data, i);
  if (w === null || !/^0{24}/.test(w)) return null;
  return "0x" + w.slice(24);
}

function uintWord(data: string, i: number): bigint | null {
  const w = word(data, i);
  return w === null ? null : BigInt("0x" + w);
}

/** At least `n` words after the selector (the ABI decoder ignores trailing bytes, e.g. attribution suffixes). */
function hasWords(data: string, n: number): boolean {
  return data.length >= 8 + n * 64;
}

/**
 * Legs for a legacy EVM tx. `data` is lowercase hex without 0x. `to` "" = contract creation.
 * msg.value > 0 always yields a native transfer leg (audit F9).
 */
export function evmLegs(from: string, to: string, value: bigint, data: string): Leg[] {
  const legs: Leg[] = [];
  const self = from.toLowerCase();
  const target = to.toLowerCase();

  if (value > 0n || data.length === 0) legs.push(transferLeg(target, value));
  if (data.length === 0) return legs;
  if (target === "") return [...legs, { kind: "contract_call", to: "", selector: "deploy" }];
  if (data.length < 8 || data.length % 2 !== 0 || !/^[0-9a-f]+$/.test(data)) return [...legs, unknownLeg("malformed calldata")];

  const sel = data.slice(0, 8);
  const call: Leg = { kind: "contract_call", to: target, selector: "0x" + sel };
  const bad = (what: string) => [...legs, unknownLeg(`malformed ${what} calldata`)];

  switch (sel) {
    case SEL.transfer: {
      const dest = addrWord(data, 0), amt = uintWord(data, 1);
      if (!hasWords(data, 2) || dest === null || amt === null) return bad("transfer");
      return [...legs, transferLeg(dest, amt, target)];
    }
    case SEL.transferFrom: {
      const src = addrWord(data, 0), dest = addrWord(data, 1), amt = uintWord(data, 2);
      if (!hasWords(data, 3) || src === null || dest === null || amt === null) return bad("transferFrom");
      return [...legs, src === self ? transferLeg(dest, amt, target) : call];
    }
    case SEL.approve:
    case SEL.increaseAllowance:
    case SEL.increaseApproval: {
      const spender = addrWord(data, 0), amt = uintWord(data, 1);
      if (!hasWords(data, 2) || spender === null || amt === null) return bad("approve");
      // approve(0x0, id) is an ERC-721 revoke. approve(x, 0) stays an approval leg: on ERC-721 it
      // approves token id 0 to x, and the signed bytes cannot tell the two standards apart.
      if (sel === SEL.approve && spender === ZERO_ADDRESS) return [...legs, call];
      // increaseAllowance adds to an allowance the signed bytes do not show → unbounded.
      const amount = sel !== SEL.approve || amt === MAX_UINT256 ? "ALL" : amt;
      return [...legs, { kind: "approval", spender, asset: { contract: target }, amount, standard: "erc20" }];
    }
    case SEL.authorizeOperator: {
      const operator = addrWord(data, 0);
      if (!hasWords(data, 1) || operator === null) return bad("authorizeOperator");
      return [...legs, { kind: "approval", spender: operator, asset: { contract: target }, amount: "ALL", standard: "erc20" }];
    }
    case SEL.transferAndCall:
    case SEL.erc777Send: {
      const dest = addrWord(data, 0), amt = uintWord(data, 1);
      if (!hasWords(data, 3) || dest === null || amt === null) return bad("token send");
      return [...legs, transferLeg(dest, amt, target)];
    }
    case SEL.nftSafeTransfer:
    case SEL.nftSafeTransferData:
    case SEL.erc1155Transfer:
    case SEL.erc1155Batch: {
      const src = addrWord(data, 0), dest = addrWord(data, 1);
      if (!hasWords(data, 3) || src === null || dest === null) return bad("NFT transfer");
      if (src !== self) return [...legs, call];
      // NFT / multi-token amounts are not priced: "ALL" keeps capped rules fail-closed.
      return [...legs, transferLeg(dest, "ALL", target)];
    }
    case SEL.setApprovalForAll: {
      const operator = addrWord(data, 0), approved = uintWord(data, 1);
      if (!hasWords(data, 2) || operator === null || approved === null) return bad("setApprovalForAll");
      if (approved === 0n) return [...legs, call];
      return [...legs, { kind: "approval", spender: operator, asset: { contract: target }, amount: "ALL", standard: "erc721_all" }];
    }
    case SEL.eip2612Permit:
    case SEL.daiPermit: {
      const owner = addrWord(data, 0), spender = addrWord(data, 1), v = uintWord(data, 2);
      if (!hasWords(data, sel === SEL.daiPermit ? 8 : 7) || owner === null || spender === null || v === null) return bad("permit");
      if (owner !== self) return [...legs, call]; // relaying someone else's permit
      if (sel === SEL.daiPermit) {
        const allowed = uintWord(data, 4);
        if (allowed === 0n) return [...legs, call];
        return [...legs, { kind: "approval", spender, asset: { contract: target }, amount: "ALL", standard: "eip2612" }];
      }
      return [...legs, { kind: "approval", spender, asset: { contract: target }, amount: v === MAX_UINT256 ? "ALL" : v, standard: "eip2612" }];
    }
  }

  if (target === PERMIT2_ADDRESS) {
    if (sel === SEL.permit2Approve) {
      const token = addrWord(data, 0), spender = addrWord(data, 1), amt = uintWord(data, 2);
      if (!hasWords(data, 4) || token === null || spender === null || amt === null) return bad("Permit2 approve");
      if (amt === 0n) return [...legs, call];
      return [...legs, { kind: "approval", spender, asset: { contract: token }, amount: amt >= (1n << 160n) - 1n ? "ALL" : amt, standard: "permit2" }];
    }
    if (sel === SEL.permit2Single) {
      // permit(owner, ((token, amount, expiration, nonce), spender, sigDeadline), bytes signature)
      const owner = addrWord(data, 0), token = addrWord(data, 1), amt = uintWord(data, 2), spender = addrWord(data, 5);
      if (owner === null || token === null || amt === null || spender === null) return bad("Permit2 permit");
      if (owner !== self) return [...legs, call];
      return [...legs, { kind: "approval", spender, asset: { contract: token }, amount: amt >= (1n << 160n) - 1n ? "ALL" : amt, standard: "permit2" }];
    }
    if (sel === SEL.permit2Batch) {
      const owner = addrWord(data, 0);
      if (owner === null) return bad("Permit2 permit");
      return [...legs, owner === self ? unknownLeg("Permit2 batch permit") : call];
    }
  }

  return [...legs, call];
}
