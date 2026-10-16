// Addresses on review screens (UX spec: review-and-sign.md "Addresses").
// Main counterparty: the full address in groups of 4, first and last group emphasised, so every
// character can be compared (the short form is what address poisoning copies).
// Other addresses: short form, tap to expand in place. Copy only where the screen allows it
// (WalletConnect yes, Send review no).

import { useState } from "react";
import { groupAddress, shortAddress, type ReviewParty } from "../../lib/review";
import { CopyableText } from "../ui/copyable-text";
import { useReviewText } from "./review-text";

export function GroupedAddress({ address, className = "" }: { address: string; className?: string }) {
  const groups = groupAddress(address);
  const last = groups.length - 1;
  const firstBody = groups[0] === "0x" ? 1 : 0;
  return (
    // Long addresses (Solana, 44 chars) get a smaller face so they fit one line on desktop; where they still
    // wrap (phones), `balance` splits the groups evenly instead of leaving a lone group on the second line.
    <span className={`block font-mono ${address.length > 42 ? "text-[11px]" : "text-xs"} leading-relaxed break-normal [text-wrap:balance] text-text-tertiary ${className}`} aria-label={address}>
      {groups.map((g, i) => (
        <span key={i} className={i <= firstBody || i === last ? "text-text-primary font-semibold" : undefined}>
          {g}
          {i < last && (g === "0x" ? "" : " ")}
        </span>
      ))}
    </span>
  );
}

interface PartyProps {
  party: ReviewParty;
  /** Full grouped address (main counterparty) instead of short + expand. */
  full?: boolean;
  copyable?: boolean;
}

/** Name (if any) above the address. */
export function PartyValue({ party, full, copyable }: PartyProps) {
  const { t } = useReviewText();
  const [open, setOpen] = useState(false);
  const expanded = full || open;
  const body = expanded ? <GroupedAddress address={party.address} /> : null;
  return (
    <span className={`flex flex-col min-w-0 ${full ? "items-start" : "items-end"}`}>
      {party.name && <span className="text-sm text-text-primary font-medium">{party.name}</span>}
      {expanded ? (
        copyable ? <CopyableText value={party.address} textClassName="break-normal">{body}</CopyableText> : body
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t("review.showAddress")}
          aria-label={`${t("review.showAddress")}: ${party.address}`}
          className="font-mono text-xs text-text-tertiary hover:text-text-primary transition-colors"
        >
          {shortAddress(party.address)}
        </button>
      )}
    </span>
  );
}

/** "to Alice · 0x3fC9…7FAD" line used by the hero and the actions list; `expandable`: tap shows the full address. */
export function PartyInline({ prefix, party, expandable }: { prefix: "to" | "for" | "account" | "program"; party: ReviewParty; expandable?: boolean }) {
  const { t } = useReviewText();
  const [open, setOpen] = useState(false);
  return (
    <span>
      {t(`review.${prefix}`)} {party.name && <>{party.name} · </>}
      {open ? <GroupedAddress address={party.address} /> : expandable ? (
        <button type="button" onClick={() => setOpen(true)} title={t("review.showAddress")} className="font-mono hover:text-text-primary underline decoration-dotted">
          {shortAddress(party.address)}
        </button>
      ) : <span className="font-mono">{shortAddress(party.address)}</span>}
    </span>
  );
}
