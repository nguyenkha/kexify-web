// Home Send step 1: pick a funded asset (UX spec: home-assets.md, mismatch #13).
// Reads the balances the account rows already polled (cache), so opening it costs no requests.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../shared/types";
import type { AccountRow } from "../lib/accountRows";
import { getCachedNativeBalance, getCachedTokenBalances } from "../lib/balance";
import { formatUsd, getUsdValue } from "../lib/prices";
import { useHideBalances } from "../context/HideBalancesContext";
import { maskAmount, maskUsd } from "../lib/hidden-amount";
import { truncateBalance } from "./sendTypes";
import { PickerDialog, PickerRow } from "./picker-dialog";

export interface FundedAsset {
  row: AccountRow;
  asset: Asset;
  balance: string;
  usd: number | null;
}

function fundedAssets(rows: AccountRow[], prices: Record<string, number>): FundedAsset[] {
  const out: FundedAsset[] = [];
  const add = (row: AccountRow, asset: Asset, balance: string) => {
    if (!(parseFloat(balance) > 0)) return;
    out.push({ row, asset, balance, usd: getUsdValue(balance, asset.symbol, prices) });
  };
  for (const row of rows) {
    const native = getCachedNativeBalance(row.address, row.chain, row.assets);
    if (native) add(row, native.data.asset, native.data.formatted);
    const tokens = getCachedTokenBalances(row.address, row.chain);
    for (const b of tokens?.data ?? []) add(row, b.asset, b.formatted);
  }
  return out.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}

interface Props {
  rows: AccountRow[];
  prices: Record<string, number>;
  walletName: (keyId: string) => string | null;
  onPick: (item: FundedAsset) => void;
  onReceive: () => void;
  onClose: () => void;
}

export function HomeSendAssetPicker({ rows, prices, walletName, onPick, onReceive, onClose }: Props) {
  const { t } = useTranslation();
  const { hidden } = useHideBalances();
  // Snapshot when opened; prices only re-sort.
  const items = useMemo(() => fundedAssets(rows, prices), [rows, prices]);

  return (
    <PickerDialog title={t("send.selectAsset")} onClose={onClose}>
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-text-secondary mb-4">{t("send.nothingToSend")}</p>
          <button
            onClick={onReceive}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors"
          >
            {t("common.receive")}
          </button>
        </div>
      ) : (
        items.map((item) => {
          const wallet = walletName(item.row.keyId);
          return (
            <PickerRow
              key={`${item.row.keyId}:${item.row.chain.id}:${item.row.address}:${item.asset.id}`}
              icon={item.asset.iconUrl || item.row.chain.iconUrl}
              title={item.asset.symbol}
              subtitle={wallet ? `${item.row.label} · ${wallet}` : item.row.label}
              onClick={() => onPick(item)}
              right={
                <>
                  <p className="text-xs tabular-nums text-text-secondary">
                    {maskAmount(truncateBalance(item.balance), item.asset.symbol, hidden)}
                  </p>
                  {item.usd != null && (
                    <p className="text-[11px] tabular-nums text-text-muted">{maskUsd(formatUsd(item.usd), hidden)}</p>
                  )}
                </>
              }
            />
          );
        })
      )}
    </PickerDialog>
  );
}
