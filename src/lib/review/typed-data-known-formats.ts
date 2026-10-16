// Known EIP-712 formats, recognised only when the declared fields EXACTLY match the canonical typehash — the same
// table as the API (api/src/policy/typed-data-formats.ts, kept equal by review-typed-data.test.ts), so the review
// calls something an approval or a transfer exactly when the server's policy does.

export type TypeDefs = Record<string, { name: string; type: string }[]>;

export type KnownFormat =
  | "Permit" | "DaiPermit" | "Erc721Permit" | "PermitForAll"
  | "PermitSingle" | "PermitBatch" | "PermitTransferFrom" | "PermitBatchTransferFrom" | "Eip3009";

const STRUCTS: Record<string, string> = {
  PermitDetails: "address token,uint160 amount,uint48 expiration,uint48 nonce",
  TokenPermissions: "address token,uint256 amount",
};

const FORMATS: [string, KnownFormat, string][] = [
  ["Permit", "Permit", "address owner,address spender,uint256 value,uint256 nonce,uint256 deadline"],
  ["Permit", "DaiPermit", "address holder,address spender,uint256 nonce,uint256 expiry,bool allowed"],
  ["Permit", "Erc721Permit", "address spender,uint256 tokenId,uint256 nonce,uint256 deadline"],
  ["PermitForAll", "PermitForAll", "address owner,address operator,bool approved,uint256 nonce,uint256 deadline"],
  ["PermitSingle", "PermitSingle", "PermitDetails details,address spender,uint256 sigDeadline"],
  ["PermitBatch", "PermitBatch", "PermitDetails[] details,address spender,uint256 sigDeadline"],
  ["PermitTransferFrom", "PermitTransferFrom", "TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline"],
  ["PermitBatchTransferFrom", "PermitBatchTransferFrom", "TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline"],
  ["TransferWithAuthorization", "Eip3009", "address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce"],
  ["ReceiveWithAuthorization", "Eip3009", "address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce"],
];

const sig = (fields: { name: string; type: string }[]) => fields.map((f) => `${f.type} ${f.name}`).join(",");

function structsMatch(spec: string, types: TypeDefs): boolean {
  for (const name of Object.keys(STRUCTS)) {
    if (spec.includes(name) && (!types[name] || sig(types[name]) !== STRUCTS[name])) return false;
  }
  return true;
}

export function canonicalFormat(primary: string, types: TypeDefs | undefined): KnownFormat | null {
  const fields = types?.[primary];
  if (!Array.isArray(fields)) return null;
  const declared = sig(fields);
  for (const [name, format, spec] of FORMATS) {
    if (name === primary && declared === spec && structsMatch(spec, types!)) return format;
  }
  return null;
}
