import { hexToBytes } from "../../shared/utils";

/** Encode ERC-721 transferFrom(address from, address to, uint256 tokenId) */
export function encodeErc721Transfer(from: string, to: string, tokenId: string): Uint8Array {
  const selector = "23b872dd"; // transferFrom
  const fromPad = from.slice(2).toLowerCase().padStart(64, "0");
  const toPad = to.slice(2).toLowerCase().padStart(64, "0");
  const idHex = BigInt(tokenId).toString(16).padStart(64, "0");
  return hexToBytes(selector + fromPad + toPad + idHex);
}

/** Encode ERC-1155 safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data) */
export function encodeErc1155SafeTransfer(from: string, to: string, tokenId: string, amount = 1): Uint8Array {
  const selector = "f242432a"; // safeTransferFrom
  const fromPad = from.slice(2).toLowerCase().padStart(64, "0");
  const toPad = to.slice(2).toLowerCase().padStart(64, "0");
  const idHex = BigInt(tokenId).toString(16).padStart(64, "0");
  const amountHex = BigInt(amount).toString(16).padStart(64, "0");
  // bytes data: offset (160 = 5 * 32), length 0, no data
  const dataOffset = (5 * 32).toString(16).padStart(64, "0");
  const dataLength = "0".padStart(64, "0");
  return hexToBytes(selector + fromPad + toPad + idHex + amountHex + dataOffset + dataLength);
}
