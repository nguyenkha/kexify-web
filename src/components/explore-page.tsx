import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { appDescription, fetchDirectory, type DappDirectory, type DirectoryApp } from "../lib/dapp-directory";

// Chain logos, same URLs as the iOS app (chains.icon_url from the API seed).
const CHAIN_ICONS: Record<string, string> = {
  ethereum: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  base: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png",
  arbitrum: "https://assets.coingecko.com/coins/images/16547/large/arb.jpg",
  polygon: "https://assets.coingecko.com/coins/images/4713/large/polygon.png",
  solana: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
  tron: "https://assets.coingecko.com/coins/images/1094/large/tron-logo.png",
};
const CHAIN_NAMES: Record<string, string> = { ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", polygon: "Polygon", solana: "Solana", tron: "TRON" };

/** Explore (Khám phá) on the web, like the iOS tab: kexify's signed directory. A web page cannot inject a wallet into another site, so a
 *  card opens the dApp in a new tab and the user connects with WalletConnect. */
export function ExplorePage() {
  const { t, i18n } = useTranslation();
  const [directory, setDirectory] = useState<DappDirectory | null>(null);
  const [failed, setFailed] = useState(false);
  const [chain, setChain] = useState<string | null>(null);

  const load = () => fetchDirectory().then(setDirectory, () => setFailed(true));
  useEffect(() => { load(); }, []);
  const retry = () => { setFailed(false); load(); };

  const chains = useMemo(() => {
    const seen = new Set(directory?.apps.flatMap((a) => a.chains) ?? []);
    return Object.keys(CHAIN_NAMES).filter((c) => seen.has(c));
  }, [directory]);

  return (
    <div className="w-full">
      <h2 className="text-lg font-semibold text-text-primary">{t("explore.title")}</h2>
      <p className="text-xs text-text-muted mt-2 leading-relaxed">
        {t("explore.webHint")} <Link to="/walletconnect" className="text-blue-500 hover:underline">{t("explore.openWalletConnect")}</Link>
      </p>

      {failed && (
        <div className="mt-5 text-xs text-text-muted">
          {t("explore.loadFailed")}{" "}
          <button onClick={retry} className="text-blue-500 hover:underline">{t("common.tryAgain")}</button>
        </div>
      )}
      {!directory && !failed && <div className="mt-5 text-xs text-text-muted">{t("common.loading")}</div>}

      {directory && (
        <>
          {directory.featured.length > 0 && (
            <section className="mt-5">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">{t("explore.featured")}</h3>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {directory.featured.map((a) => <AppCard key={a.id} app={a} lang={i18n.language} big />)}
              </div>
            </section>
          )}

          <div className="mt-5 flex flex-wrap gap-1.5">
            <Chip label={t("explore.allChains")} selected={chain === null} onClick={() => setChain(null)} />
            {chains.map((c) => <Chip key={c} label={CHAIN_NAMES[c]} selected={chain === c} onClick={() => setChain(c)} />)}
          </div>

          {directory.categories.map((cat) => {
            const apps = directory.apps.filter((a) => a.category === cat && (!chain || a.chains.includes(chain)));
            if (apps.length === 0) return null;
            return (
              <section key={cat} className="mt-5">
                <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">{t(`explore.category.${cat}`)}</h3>
                <div className="mt-2 flex flex-col gap-1.5">
                  {apps.map((a) => <AppCard key={a.id} app={a} lang={i18n.language} />)}
                </div>
              </section>
            );
          })}
          <p className="mt-6 text-[11px] text-text-muted leading-relaxed">{t("explore.footer")}</p>
        </>
      )}
    </div>
  );
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border ${selected ? "bg-blue-600 text-white border-blue-600" : "bg-surface-secondary text-text-primary border-border-primary hover:border-blue-500/50"}`}
    >
      {label}
    </button>
  );
}

function AppIcon({ app }: { app: DirectoryApp }) {
  const [broken, setBroken] = useState(false);
  // The site's own favicon; its first letter when it has none (no third-party icon service).
  return broken ? (
    <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-500 font-semibold flex items-center justify-center shrink-0">
      {app.name.charAt(0)}
    </div>
  ) : (
    <img src={`${app.url}/favicon.ico`} alt="" className="w-9 h-9 rounded-lg bg-surface-tertiary object-contain shrink-0" onError={() => setBroken(true)} />
  );
}

function ChainLogos({ chains }: { chains: string[] }) {
  return (
    <div className="flex -space-x-1 shrink-0">
      {chains.slice(0, 4).map((c) => CHAIN_ICONS[c] && (
        <img key={c} src={CHAIN_ICONS[c]} alt={CHAIN_NAMES[c]} title={CHAIN_NAMES[c]} className="w-4 h-4 rounded-full bg-surface-secondary ring-2 ring-surface-secondary" />
      ))}
    </div>
  );
}

/** One app: icon, then name + chains on the first line, description and domain under it. Every row has the same
 *  columns, so nothing shifts with the length of a name. */
function AppCard({ app, lang, big }: { app: DirectoryApp; lang: string; big?: boolean }) {
  const host = new URL(app.url).host;
  return (
    // The pinned URL from the signed list; rel=noopener so the dApp cannot reach back into the wallet tab.
    <a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-start gap-3 rounded-xl bg-surface-secondary border border-border-primary hover:border-blue-500/50 transition-colors ${big ? "p-3.5 h-full" : "px-3 py-2.5"}`}
    >
      <AppIcon app={app} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{app.name}</span>
          <ChainLogos chains={app.chains} />
        </div>
        <div className={`text-xs text-text-secondary mt-0.5 ${big ? "line-clamp-2" : "truncate"}`}>{appDescription(app, lang)}</div>
        <div className="text-[11px] text-text-muted truncate mt-0.5">{host}</div>
      </div>
    </a>
  );
}
