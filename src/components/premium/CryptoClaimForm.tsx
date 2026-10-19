// Paste the transaction hash and claim the payment. A 202 (still confirming) is polled every 15 s for ~10 min.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ErrorBox } from "../ui";
import { claimCryptoIntent, type CryptoIntent } from "../../lib/premium-api";
import { payErrorKey } from "./pay-error-key";

const POLL_MS = 15_000;
const POLL_MAX = 40; // 10 minutes

export function CryptoClaimForm({ intent, onCredited }: { intent: CryptoIntent; onCredited: () => void }) {
  const { t } = useTranslation();
  const [hash, setHash] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "confirming">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }, []);

  async function claim(attempt: number) {
    const r = await claimCryptoIntent(intent.id, hash);
    if (!alive.current) return;
    if (r.ok && r.status === "credited") return onCredited();
    if (r.ok) {
      if (attempt >= POLL_MAX) { setState("idle"); return setError(t("premium.pay.stillConfirming")); }
      setState("confirming");
      timer.current = setTimeout(() => void claim(attempt + 1), POLL_MS);
      return;
    }
    setState("idle");
    setError(r.code === "amount_mismatch" && r.received ? t("premium.error.amount_mismatch_received", { received: r.received, amount: intent.amount }) : t(payErrorKey(r.code)));
  }

  function submit() {
    if (!hash.trim()) return;
    setError(null); setState("sending");
    void claim(1);
  }

  return (
    <div className="space-y-2 border-t border-border-secondary pt-4">
      <label className="text-xs font-medium text-text-secondary" htmlFor="premium-tx-hash">{t("premium.pay.txHash")}</label>
      <input id="premium-tx-hash" value={hash} onChange={(e) => setHash(e.target.value)} disabled={state !== "idle"} spellCheck={false} autoComplete="off"
        placeholder={t("premium.pay.txHashPlaceholder")}
        className="w-full bg-surface-primary border border-border-primary rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors" />
      {error && <ErrorBox>{error}</ErrorBox>}
      {state === "confirming" && <p role="status" className="text-xs text-text-muted">{t("premium.pay.confirming")}</p>}
      <Button fullWidth disabled={state !== "idle" || !hash.trim()} onClick={submit}>
        {state === "idle" ? t("premium.pay.verify") : t("premium.pay.checking")}
      </Button>
    </div>
  );
}
