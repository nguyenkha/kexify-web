// Home Receive step 1: pick a network (UX spec: receive.md "Entry points").
// Each chain account once; tokens share their chain's address, so search also matches token symbols.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccountRow } from "../lib/accountRows";
import { shortAddr } from "../lib/tx-display";
import { PickerDialog, PickerRow } from "./picker-dialog";

interface Props {
  rows: AccountRow[];
  walletName: (keyId: string) => string | null;
  onPick: (row: AccountRow) => void;
  onClose: () => void;
}

export function ReceiveNetworkPicker({ rows, walletName, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const usable = rows.filter((r) => r.assets.length > 0);
    if (!q) return usable;
    return usable.filter((r) =>
      [r.label, r.chain.displayName, r.chain.name, ...r.assets.map((a) => a.symbol)]
        .some((s) => s.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <PickerDialog
      title={t("manageDisplay.selectNetwork")}
      onClose={onClose}
      search={{ value: query, onChange: setQuery, placeholder: t("receive.search") }}
    >
      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-text-muted">{t("receive.noMatch")}</p>
      ) : (
        filtered.map((row) => {
          const wallet = walletName(row.keyId);
          return (
            <PickerRow
              key={`${row.keyId}:${row.chain.id}:${row.address}`}
              icon={row.chain.iconUrl}
              title={row.label}
              subtitle={<span className="font-mono">{shortAddr(row.address)}{wallet ? <span className="font-sans"> · {wallet}</span> : null}</span>}
              onClick={() => onPick(row)}
            />
          );
        })
      )}
    </PickerDialog>
  );
}
