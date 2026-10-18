// Settings → Custom networks (Expert mode): add an EVM network (L2, devnet, local Anvil / Hardhat) by name,
// chainId, RPC, symbol, explorer and testnet flag. The RPC must answer eth_chainId with the declared id, or
// the network is refused. Stored locally per user; native coin only.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { Chain } from "../../shared/types";
import type { UserOverrides } from "../../lib/userOverrides";
import { ChainIdMismatchError, customNetworkInputError, verifyCustomNetwork, type CustomNetworkInput } from "../../lib/custom-networks";
import { ConfirmDialog } from "../ui/confirm-dialog";

const EMPTY: CustomNetworkInput = { name: "", chainId: "", rpcUrl: "", symbol: "ETH", explorerUrl: "", testnet: true };
const FIELD = "w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors";

interface Props {
  overrides: UserOverrides;
  save: (next: UserOverrides) => void;
  builtIn: Chain[];
}

export function CustomNetworksSection({ overrides, save, builtIn }: Props) {
  const { t } = useTranslation();
  const networks = overrides.custom_networks ?? [];
  const [form, setForm] = useState<CustomNetworkInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const set = (patch: Partial<CustomNetworkInput>) => form && setForm({ ...form, ...patch });

  async function add() {
    if (!form) return;
    const key = customNetworkInputError(form, builtIn, networks);
    if (key) return setError(t(key));
    setChecking(true);
    setError(null);
    try {
      const n = await verifyCustomNetwork(form);
      save({ ...overrides, custom_networks: [...networks, n] });
      setForm(null);
    } catch (e) {
      setError(e instanceof ChainIdMismatchError
        ? t("customNetwork.err.mismatch", { actual: String(e.actual), declared: String(e.declared) })
        : t("customNetwork.err.unreachable"));
    } finally {
      setChecking(false);
    }
  }

  function remove(chainId: number) {
    const rest = networks.filter((n) => n.chain_id !== chainId);
    save({ ...overrides, custom_networks: rest.length ? rest : undefined });
    setRemoving(null);
  }

  return (
    <div>
      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold mb-2 px-1">{t("customNetwork.title")}</p>
      <div className="bg-surface-secondary rounded-lg border border-border-primary overflow-hidden divide-y divide-border-secondary">
        {networks.map((n) => (
          <div key={n.chain_id} className="flex items-center gap-3 px-3 md:px-5 py-3" data-testid="custom-network-row">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary flex items-center gap-1.5">
                {n.name}
                <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">{t("config.custom")}</span>
                {n.testnet && <span className="text-[10px] px-1 py-0.5 rounded bg-yellow-500/10 text-yellow-500 uppercase font-semibold">testnet</span>}
              </div>
              <p className="text-[11px] text-text-muted font-mono truncate">{t("customNetwork.summary", { chainId: String(n.chain_id), symbol: n.symbol })} · {n.rpc_url}</p>
            </div>
            <button onClick={() => setRemoving(n.chain_id)} className="p-1.5 text-text-muted hover:text-red-400 transition-colors" title={t("customNetwork.remove")}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {form ? (
          <div className="px-3 md:px-5 py-4 space-y-2.5">
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("customNetwork.name")} className={FIELD} />
            <div className="flex gap-2">
              <input value={form.chainId} onChange={(e) => set({ chainId: e.target.value })} placeholder={t("customNetwork.chainId")} inputMode="numeric" className={`${FIELD} font-mono`} />
              <input value={form.symbol} onChange={(e) => set({ symbol: e.target.value })} placeholder={t("customNetwork.symbol")} className={`${FIELD} w-28`} />
            </div>
            <input value={form.rpcUrl} onChange={(e) => set({ rpcUrl: e.target.value })} placeholder="https://… or http://127.0.0.1:8545" className={`${FIELD} font-mono`} />
            <input value={form.explorerUrl} onChange={(e) => set({ explorerUrl: e.target.value })} placeholder={t("customNetwork.explorerOptional")} className={`${FIELD} font-mono`} />
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input type="checkbox" checked={form.testnet} onChange={(e) => set({ testnet: e.target.checked })} />
              {t("customNetwork.testnet")}
            </label>
            {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={add} disabled={checking} className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-colors">
                {checking ? t("customNetwork.checking") : t("customNetwork.add")}
              </button>
              <button onClick={() => { setForm(null); setError(null); }} className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-tertiary transition-colors">{t("common.cancel")}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setForm(EMPTY)} className="w-full text-left px-3 md:px-5 py-3 text-sm text-blue-400 hover:bg-surface-tertiary/40 transition-colors">
            + {t("customNetwork.addButton")}
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-muted mt-2 px-1">{t("customNetwork.note")}</p>
      <ConfirmDialog
        open={removing !== null}
        message={t("customNetwork.removeBody")}
        confirmLabel={t("customNetwork.remove")}
        onConfirm={() => removing !== null && remove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
