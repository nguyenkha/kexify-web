// The memo / destination tag a history row shows (iOS KexifyCore HistoryMemo reads the same fields, same cases).
import type { TxMemo } from "../../shared/types";

/**
 * Stellar: the memo of a Horizon operation / payment record joined with its transaction (`?join=transactions`).
 * text and id as they are; hash and return (32 bytes, base64 on Horizon) as hex. undefined = none.
 */
export function xlmTxMemo(record: { transaction?: { memo_type?: string; memo?: string } }): TxMemo | undefined {
  const tx = record.transaction;
  if (!tx?.memo_type || !tx.memo) return undefined;
  switch (tx.memo_type) {
    case "text":
    case "id":
      return { kind: "memo", value: tx.memo };
    case "hash":
    case "return": {
      const bytes = Uint8Array.from(atob(tx.memo), (c) => c.charCodeAt(0));
      return { kind: "memo", value: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") };
    }
    default:
      return undefined;
  }
}

/** XRP: the payment's DestinationTag (uint32). undefined = none. */
export function xrpTxMemo(tx: Record<string, unknown>): TxMemo | undefined {
  const tag = tx.DestinationTag;
  return typeof tag === "number" ? { kind: "destinationTag", value: String(tag) } : undefined;
}
