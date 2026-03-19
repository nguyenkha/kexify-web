import { useState, useEffect, useCallback } from "react";
import type { Chain, NftItem } from "../shared/types";
import { fetchNFTs } from "../lib/chains/evmAdapter";
import { Spinner } from "./ui";
import { NftDetail } from "./NftDetail";

interface NftGalleryProps {
  address: string;
  chain: Chain;
  keyId: string;
}

/** Placeholder SVG for NFTs without images */
function NftPlaceholder() {
  return (
    <div className="w-full aspect-square bg-surface-tertiary flex items-center justify-center">
      <svg className="w-8 h-8 text-text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
      </svg>
    </div>
  );
}

export function NftGallery({ address, chain, keyId }: NftGalleryProps) {
  const [nfts, setNfts] = useState<NftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextPage, setNextPage] = useState<Record<string, string | number> | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<NftItem | null>(null);

  const loadNfts = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchNFTs(address, chain.explorerUrl);
      setNfts(result.items);
      setHasMore(result.hasMore);
      setNextPage(result.nextPageParams);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [address, chain.explorerUrl]);

  useEffect(() => { loadNfts(); }, [loadNfts]);

  async function loadMore() {
    if (!nextPage || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchNFTs(address, chain.explorerUrl, nextPage);
      setNfts((prev) => [...prev, ...result.items]);
      setHasMore(result.hasMore);
      setNextPage(result.nextPageParams);
    } catch { /* ignore */ }
    setLoadingMore(false);
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface-secondary rounded-lg border border-border-primary overflow-hidden animate-pulse">
            <div className="aspect-square bg-surface-tertiary" />
            <div className="p-2.5 space-y-1.5">
              <div className="h-3 w-20 bg-surface-tertiary rounded" />
              <div className="h-2.5 w-14 bg-surface-tertiary/60 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-xs text-text-muted">Failed to load NFTs</p>
        <button onClick={loadNfts} className="text-xs text-blue-400 hover:text-blue-300 mt-1">Retry</button>
      </div>
    );
  }

  if (nfts.length === 0) {
    return (
      <div className="text-center py-10">
        <svg className="w-8 h-8 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
        </svg>
        <p className="text-sm text-text-tertiary">No NFTs found</p>
        <p className="text-xs text-text-muted mt-1">ERC-721 and ERC-1155 tokens will appear here.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {nfts.map((nft) => (
          <button
            key={nft.id}
            onClick={() => setSelected(nft)}
            className="bg-surface-secondary rounded-lg border border-border-primary overflow-hidden hover:border-border-secondary transition-colors text-left"
          >
            {nft.imageUrl ? (
              <img
                src={nft.imageUrl}
                alt={nft.name || `#${nft.tokenId}`}
                className="w-full aspect-square object-cover"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; e.currentTarget.parentElement?.querySelector(".nft-placeholder")?.classList.remove("hidden"); }}
              />
            ) : null}
            {!nft.imageUrl && <NftPlaceholder />}
            <div className="p-2.5">
              <p className="text-xs font-medium text-text-primary truncate">
                {nft.name || `#${nft.tokenId}`}
              </p>
              <p className="text-[10px] text-text-muted truncate">{nft.collection.name}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="mt-3 text-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs text-text-tertiary hover:text-text-secondary transition-colors py-2 px-4 disabled:opacity-50"
          >
            {loadingMore ? <Spinner size="xs" /> : "Load more"}
          </button>
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <NftDetail
          nft={selected}
          chain={chain}
          address={address}
          keyId={keyId}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
