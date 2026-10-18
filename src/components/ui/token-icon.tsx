import { useState } from "react";

interface Props {
  iconUrl?: string | null;
  symbol: string;
  /** Tried when iconUrl is missing or fails to load (e.g. the chain logo). */
  fallbackUrl?: string | null;
  className?: string;
}

/** Token logo with the same fallbacks everywhere: asset icon, then chain icon, then a letter monogram. */
export function TokenIcon({ iconUrl, symbol, fallbackUrl, className = "w-7 h-7" }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = [iconUrl, fallbackUrl].find((u): u is string => !!u && u !== failed);
  if (url) {
    return <img src={url} alt="" onError={() => setFailed(url)} className={`${className} rounded-full bg-surface-tertiary shrink-0 object-cover`} />;
  }
  return (
    <span aria-hidden className={`${className} rounded-full bg-surface-tertiary text-text-secondary shrink-0 inline-flex items-center justify-center text-[11px] font-semibold`}>
      {(symbol.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
