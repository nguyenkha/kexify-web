// Hero summary (UX spec: review-and-sign.md "Hero by request kind"): what happens to the money,
// readable in two seconds. Icon, verb, amount, fiat and the counterparty.

import { AlertTriangle, ArrowUp, FileCode2, KeyRound, Layers, PenLine } from "lucide-react";
import type { HeroIcon, HeroTone, ReviewHero as Hero } from "../../lib/review";
import { PartyInline } from "./review-address";
import { useReviewText } from "./review-text";

const ICONS: Record<HeroIcon, typeof ArrowUp> = {
  send: ArrowUp, approve: KeyRound, contract: FileCode2, stack: Layers, sign: PenLine, warning: AlertTriangle,
};
const TONES: Record<HeroTone, string> = {
  accent: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export function ReviewHero({ hero }: { hero: Hero }) {
  const { t, text, usd } = useReviewText();
  const Icon = ICONS[hero.icon];
  const amount = text(hero.amount);
  return (
    <div className="text-center py-1" data-testid="review-hero">
      <div className={`w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center ${TONES[hero.tone]}`}>
        <Icon className="w-6 h-6" aria-hidden />
      </div>
      <p className="text-xs font-medium text-text-muted">{text(hero.verb)}</p>
      {amount && (
        <p className={`font-bold tracking-tight tabular-nums text-text-primary break-words ${amount.length > 18 ? "text-xl" : "text-[28px] leading-tight"}`}>
          {amount}
        </p>
      )}
      {hero.usd != null && <p className="text-sm text-text-muted tabular-nums">≈ {usd(hero.usd)}</p>}
      {hero.sub && <p className="text-sm text-text-muted">{text(hero.sub)}</p>}
      {hero.counterparty && (
        <p className="text-sm text-text-secondary mt-1">
          <PartyInline prefix={hero.counterparty.prefix} party={hero.counterparty.party} />
        </p>
      )}
      {hero.noFundsMove && (
        <span className="inline-block mt-2 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
          {t("review.noFundsMove")}
        </span>
      )}
    </div>
  );
}
