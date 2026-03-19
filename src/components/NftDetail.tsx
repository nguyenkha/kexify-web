import type { Chain, NftItem } from "../shared/types";
import { explorerLink } from "../shared/utils";

interface NftDetailProps {
  nft: NftItem;
  chain: Chain;
  address: string;
  keyId: string;
  onClose: () => void;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length <= 16) return addr || "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function NftDetail({ nft, chain, onClose }: NftDetailProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface-secondary border border-border-primary rounded-2xl w-full max-w-sm shadow-xl overflow-hidden max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-secondary">
          <h3 className="text-sm font-semibold text-text-primary truncate">
            {nft.name || `#${nft.tokenId}`}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors shrink-0 ml-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Image */}
        {nft.imageUrl ? (
          <img
            src={nft.imageUrl}
            alt={nft.name || `#${nft.tokenId}`}
            className="w-full aspect-square object-cover"
          />
        ) : (
          <div className="w-full aspect-square bg-surface-tertiary flex items-center justify-center">
            <svg className="w-12 h-12 text-text-muted/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </div>
        )}

        {/* Info */}
        <div className="p-4 space-y-3">
          <p className="text-xs text-text-muted">{nft.collection.name}</p>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Token ID</span>
              <span className="text-text-secondary font-mono">{nft.tokenId.length > 12 ? shortAddr(nft.tokenId) : nft.tokenId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Type</span>
              <span className="text-text-secondary">{nft.tokenType}</span>
            </div>
            {nft.contractAddress && (
              <div className="flex justify-between">
                <span className="text-text-muted">Contract</span>
                <a
                  href={explorerLink(chain.explorerUrl, `/address/${nft.contractAddress}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 font-mono"
                >
                  {shortAddr(nft.contractAddress)}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
