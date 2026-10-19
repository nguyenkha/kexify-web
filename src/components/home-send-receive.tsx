// Home-level Send / Receive under the portfolio value (UX spec: home-assets.md, mismatch #13).
// Send: pick a funded asset, then the existing SendDialog. Receive: pick a network, then the
// receive view. Send is disabled while frozen with the reason inline; Receive always works.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AccountRow } from "../lib/accountRows";
import { useFrozen } from "../context/FrozenContext";
import { useOnlineStatus } from "../lib/use-online-status";
import { useToast } from "../context/ToastContext";
import { notifyBalanceRefresh } from "../lib/dataCache";
import { HomeSendAssetPicker, type FundedAsset } from "./home-send-asset-picker";
import { ReceiveNetworkPicker } from "./receive-network-picker";
import { SendDialog } from "./SendDialog";
import { ViewOnlyCard } from "./settings/view-only-card";
import { useViewOnlyKeys } from "../lib/use-view-only-keys";
import { QrModal } from "./QrModal";

type Step =
  | { kind: "idle" }
  | { kind: "pickAsset" }
  | { kind: "send"; item: FundedAsset }
  | { kind: "pickNetwork" }
  | { kind: "receive"; row: AccountRow };

interface Props {
  rows: AccountRow[];
  prices: Record<string, number>;
  walletName: (keyId: string) => string | null;
}

export function HomeSendReceive({ rows, prices, walletName }: Props) {
  const { t } = useTranslation();
  const frozen = useFrozen();
  const online = useOnlineStatus();
  // Signing needs the server share: Send is off while frozen or offline, with the reason shown.
  const keyIds = [...new Set(rows.map((r) => r.keyId))];
  const viewOnlyKeys = useViewOnlyKeys(keyIds);
  // View only on this device for every wallet shown: nothing here can sign.
  const allViewOnly = keyIds.length > 0 && viewOnlyKeys.length === keyIds.length;
  const sendBlockedReason = frozen ? t("freeze.blockedReason") : !online ? t("common.offlineReason") : allViewOnly ? t("signers.device.viewOnly") : null;
  const { addToast } = useToast();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const close = () => setStep({ kind: "idle" });

  const receiveAsset = step.kind === "receive"
    ? step.row.assets.find((a) => a.isNative) ?? step.row.assets[0]
    : undefined;

  return (
    <div className="flex flex-col items-center -mt-2">
      <div className="flex items-center justify-center gap-6">
        <button
          onClick={() => setStep({ kind: "pickAsset" })}
          disabled={!!sendBlockedReason}
          className="flex flex-col items-center gap-1.5 group disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors shadow-md ${sendBlockedReason ? "bg-surface-tertiary shadow-none" : "bg-blue-600 group-hover:bg-blue-500 group-active:bg-blue-700 shadow-blue-600/25"}`}>
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </div>
          <span className="text-[11px] text-text-muted group-hover:text-text-secondary transition-colors">{t("common.send")}</span>
        </button>
        <button onClick={() => setStep({ kind: "pickNetwork" })} className="flex flex-col items-center gap-1.5 group">
          <div className="w-11 h-11 rounded-full bg-surface-tertiary group-hover:bg-border-primary group-active:bg-border-secondary flex items-center justify-center transition-colors">
            <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
          <span className="text-[11px] text-text-muted group-hover:text-text-secondary transition-colors">{t("common.receive")}</span>
        </button>
      </div>
      {sendBlockedReason && <p className="text-[11px] text-text-muted mt-2">{sendBlockedReason}</p>}
      {viewOnlyKeys.map((id) => (
        <div key={id} className="w-full mt-3"><ViewOnlyCard keyShareId={id} walletName={walletName(id)} /></div>
      ))}

      {step.kind === "pickAsset" && (
        <HomeSendAssetPicker
          rows={rows.filter((r) => !viewOnlyKeys.includes(r.keyId))}
          prices={prices}
          walletName={walletName}
          onPick={(item) => setStep({ kind: "send", item })}
          onReceive={() => setStep({ kind: "pickNetwork" })}
          onClose={close}
        />
      )}
      {step.kind === "send" && (
        <SendDialog
          keyId={step.item.row.keyId}
          asset={step.item.asset}
          chain={step.item.row.chain}
          address={step.item.row.address}
          balance={step.item.balance}
          onClose={close}
          onTxConfirmed={() => {
            addToast(t("notify.txConfirmed"), "success");
            notifyBalanceRefresh();
          }}
        />
      )}
      {step.kind === "pickNetwork" && (
        <ReceiveNetworkPicker rows={rows} walletName={walletName} onPick={(row) => setStep({ kind: "receive", row })} onClose={close} />
      )}
      {step.kind === "receive" && receiveAsset && (
        <QrModal address={step.row.address} asset={receiveAsset} chain={step.row.chain} onClose={close} />
      )}
    </div>
  );
}
