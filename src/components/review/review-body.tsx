// One review layout for Send → Review and every WalletConnect request
// (UX spec: docs/ux/review-and-sign.md): warnings → hero → actions → details → fee/total → raw.
// The end sentinel drives the "Scroll to review all" gate on Confirm.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ReviewModel } from "../../lib/review";
import { ReviewDetails, type TokenIconOf } from "./review-details";
import { ReviewHero } from "./review-hero";
import { ReviewWarnings } from "./review-warnings";
import { useReviewText } from "./review-text";

interface Props {
  model: ReviewModel;
  /** WalletConnect allows copying expanded addresses; Send review does not. */
  copyable: boolean;
  expert?: boolean;
  onReviewPolicy?: () => void;
  /** Extra content between the details and the end sentinel (approve editor, expert fields). */
  children?: ReactNode;
  /** Called once the end of the review has been on screen. */
  onSeenEnd?: () => void;
  /** Right under the hero (the spending-cap editor). */
  heroAccessory?: ReactNode;
  /** Logo for the Token row. */
  tokenIcon?: TokenIconOf;
}

export function ReviewBody({ model, copyable, expert, onReviewPolicy, children, onSeenEnd, heroAccessory, tokenIcon }: Props) {
  const { t } = useReviewText();
  const end = useRef<HTMLDivElement>(null);
  useSeenEnd(end, onSeenEnd);
  return (
    <div className="space-y-4" data-testid="review-body">
      <ReviewWarnings warnings={model.warnings} onReviewPolicy={onReviewPolicy} />
      <ReviewHero hero={model.hero} />
      {heroAccessory}
      {model.permitFixed && <p className="text-xs text-text-muted text-center -mt-2 px-4">{t("review.permitFixed")}</p>}
      <ReviewDetails model={model} copyable={copyable} expert={expert} tokenIcon={tokenIcon} />
      {children}
      <div ref={end} aria-hidden className="h-px" />
    </div>
  );
}

function useSeenEnd(ref: React.RefObject<HTMLDivElement | null>, onSeen?: () => void) {
  const cb = useRef(onSeen);
  useEffect(() => {
    cb.current = onSeen;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Any scrolling ancestor (modal body on desktop, the page on mobile) counts.
    if (typeof IntersectionObserver === "undefined") {
      cb.current?.();
      return;
    }
    // The bottom margin keeps the pinned footer out: content behind it has not been seen.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        cb.current?.();
        io.disconnect();
      }
    }, { rootMargin: "0px 0px -96px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

/**
 * Confirm gate (Rabby-style): false until the end of the review has been seen once.
 * `resetKey` restarts it when the content changes to a different request.
 */
export function useScrollGate(resetKey: string): { seen: boolean; onSeenEnd: () => void } {
  const [seenKey, setSeenKey] = useState<string | null>(null);
  return { seen: seenKey === resetKey, onSeenEnd: () => setSeenKey(resetKey) };
}
