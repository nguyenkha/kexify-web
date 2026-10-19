import type { Asset, Chain } from "../shared/types";
import { showChainBadge } from "../lib/asset-icon";

const SIZES = {
  sm: { box: "w-7 h-7", badge: "w-[12px] h-[12px] -right-0.5 -bottom-0.5", text: "text-[10px]" },
  md: { box: "w-9 h-9", badge: "w-[15px] h-[15px] -right-0.5 -bottom-0.5", text: "text-xs" },
  lg: { box: "w-14 h-14", badge: "w-[22px] h-[22px] -right-1 -bottom-1", text: "text-lg" },
} as const;

/** Token icon (the coin's own icon, also for ETH on an L2) with a small chain badge bottom-right where it adds information. */
export function AssetIcon({ asset, chain, size = "md" }: { asset: Asset; chain: Chain; size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  const badge = showChainBadge(asset, chain);
  return (
    <div className={`relative shrink-0 ${s.box}`}>
      {asset.iconUrl ? (
        <img src={asset.iconUrl} alt={asset.symbol} className={`${s.box} rounded-full bg-surface-tertiary`} />
      ) : (
        <div className={`${s.box} rounded-full bg-surface-tertiary flex items-center justify-center ${s.text} font-bold text-text-muted`}>
          {asset.symbol.slice(0, 1)}
        </div>
      )}
      {badge && (
        chain.iconUrl ? (
          <img src={chain.iconUrl} alt={chain.displayName} className={`absolute ${s.badge} rounded-full bg-surface-secondary ring-2 ring-surface-secondary`} />
        ) : (
          <div className={`absolute ${s.badge} rounded-full bg-surface-tertiary ring-2 ring-surface-secondary`} />
        )
      )}
    </div>
  );
}
