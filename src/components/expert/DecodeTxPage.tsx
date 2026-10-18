// Expert tool: decode a pasted raw transaction (EVM, Solana, BTC / LTC / DOGE raw or PSBT) into the
// same review the signing screens show, plus a free simulation. Read-only: no sign, no broadcast here.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileSearch } from "lucide-react";
import { ErrorBox } from "../ui";
import { ReviewBody } from "../review/review-body";
import { SimulationPreview } from "../tx/SimulationPreview";
import { fetchAssets, fetchChains, type Chain } from "../../lib/api";
import type { Asset } from "../../shared/types";
import { applyChainOverrides } from "../../lib/userOverrides";
import { getIdentityId } from "../../lib/auth";
import { trackExpertToolOnce } from "../../lib/expert-usage";
import { buildDecodedReview, decodedFacts, decodeRawTx, decodeWarnings, type DecodedRawTx } from "../../lib/expert/decode-raw-tx";
import type { UtxoNetwork } from "../../lib/expert/utxo-script-address";
import { simulationChain, useDecodedTxSimulation } from "./use-decoded-tx-simulation";

const UTXO_NETWORKS: UtxoNetwork[] = ["btc", "btc-testnet", "ltc", "ltc-testnet", "doge", "doge-testnet"];
const FIELD = "w-full bg-surface-secondary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-blue-500 transition-colors";

export function DecodeTxPage() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");
  const [network, setNetwork] = useState<UtxoNetwork>("btc");
  const [from, setFrom] = useState("");
  const [chains, setChains] = useState<Chain[]>([]);
  const [solanaChainId, setSolanaChainId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    fetchChains().then((c) => {
      const merged = applyChainOverrides(c, getIdentityId() ?? undefined);
      setChains(merged);
      setSolanaChainId(merged.find((x) => x.type === "solana")?.id ?? "");
    });
    fetchAssets().then(setAssets, () => {});
  }, []);

  const result = useMemo((): { decoded: DecodedRawTx } | { error: string } | null => {
    if (!raw.trim()) return null;
    try {
      return { decoded: decodeRawTx(raw, network) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [raw, network]);
  const decoded = result && "decoded" in result ? result.decoded : null;
  useEffect(() => {
    if (decoded) trackExpertToolOnce("tx_decode");
  }, [decoded]);

  const chain = simulationChain(decoded, chains, solanaChainId);
  const review = useMemo(
    () => decoded && buildDecodedReview(decoded, { evmNativeSymbol: assets.find((a) => a.isNative && a.chainId === chain?.id)?.symbol, from: from.trim() || undefined }),
    [decoded, chain, from, assets],
  );
  const sim = useDecodedTxSimulation(decoded, chain, from);

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2"><FileSearch className="w-5 h-5" />{t("expert.decode.title")}</h2>
        <p className="text-xs text-text-muted mt-1">{t("expert.decode.desc")}</p>
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1.5">{t("expert.decode.input")}</label>
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={t("expert.decode.placeholder")} rows={6}
          className={`${FIELD} font-mono placeholder:text-text-muted resize-none`} data-testid="decode-input" />
      </div>

      {(decoded?.kind === "utxo" || !decoded) && (
        <div>
          <label className="block text-xs text-text-muted mb-1.5">{t("expert.decode.utxoNetwork")}</label>
          <select value={network} onChange={(e) => setNetwork(e.target.value as UtxoNetwork)} className={FIELD}>
            {UTXO_NETWORKS.map((n) => <option key={n} value={n}>{t(`expert.decode.network.${n}`)}</option>)}
          </select>
        </div>
      )}

      {result && "error" in result && <ErrorBox><span className="block text-xs break-all">{result.error}</span></ErrorBox>}

      {decoded && review && (
        <>
          {decodeWarnings(decoded).map((k) => (
            <div key={k} className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-500">{t(k)}</div>
          ))}
          <ReviewBody model={review} copyable expert />
          <dl className="bg-surface-secondary border border-border-primary rounded-lg divide-y divide-border-secondary text-xs" data-testid="decode-facts">
            {decodedFacts(decoded).map((f) => (
              <div key={f.key} className="flex justify-between gap-3 px-3 py-2">
                <dt className="text-text-muted shrink-0">{t(f.key)}</dt>
                <dd className="text-text-primary font-mono break-all text-right">{f.valueKey ? t(f.valueKey) : f.value}</dd>
              </div>
            ))}
          </dl>
          {decoded.kind === "evm" && !decoded.tx.signed && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">{t("expert.decode.fromForSim")}</label>
              <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="0x…" className={`${FIELD} font-mono`} />
            </div>
          )}
          {decoded.kind === "solana" && (
            <div>
              <label className="block text-xs text-text-muted mb-1.5">{t("expert.decode.simNetwork")}</label>
              <select value={solanaChainId} onChange={(e) => setSolanaChainId(e.target.value)} className={FIELD}>
                {chains.filter((c) => c.type === "solana").map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </div>
          )}
          <SimulationBlock state={sim} chainName={chain?.displayName} />
          <p className="text-[11px] text-text-muted">{t("expert.decode.readOnly")}</p>
        </>
      )}
    </div>
  );
}

function SimulationBlock({ state, chainName }: { state: ReturnType<typeof useDecodedTxSimulation>; chainName?: string }) {
  const { t } = useTranslation();
  if (state.status === "idle") return null;
  if (state.status === "noChain") return <p className="text-xs text-text-muted">{t("expert.decode.simNoChain")}</p>;
  if (state.status === "running") return <p className="text-xs text-text-muted">{t("expert.decode.simRunning")}</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs text-text-muted">{t("expert.decode.simOn", { network: chainName ?? "" })}</p>
      <SimulationPreview simResult={state.result} />
    </div>
  );
}

