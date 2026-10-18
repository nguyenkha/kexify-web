// Expert tool: verify a signature — EIP-191 personal_sign, EIP-712 typed data (recovers the signer)
// or Solana signMessage (ed25519 against an address). Read-only, offline: no RPC, no signing.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BadgeCheck, CircleX, ShieldCheck } from "lucide-react";
import { ErrorBox } from "../ui";
import { trackExpertToolOnce } from "../../lib/expert-usage";
import { verifySignature, type SignatureScheme, type VerifyResult } from "../../lib/expert/verify-signature";

const SCHEMES: SignatureScheme[] = ["eip191", "eip712", "solana"];
const FIELD = "w-full bg-surface-secondary border border-border-primary rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors";

export function VerifySignaturePage() {
  const { t } = useTranslation();
  const [scheme, setScheme] = useState<SignatureScheme>("eip191");
  const [message, setMessage] = useState("");
  const [signature, setSignature] = useState("");
  const [expected, setExpected] = useState("");

  const result = useMemo((): VerifyResult | { error: string } | null => {
    if (!message || !signature.trim() || (scheme === "solana" && !expected.trim())) return null;
    try {
      const r = verifySignature(scheme, message, signature, expected);
      trackExpertToolOnce("signature_verify");
      return r;
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [scheme, message, signature, expected]);

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2"><ShieldCheck className="w-5 h-5" />{t("expert.verify.title")}</h2>
        <p className="text-xs text-text-muted mt-1">{t("expert.verify.desc")}</p>
      </div>

      <div className="flex gap-1 bg-surface-secondary border border-border-primary rounded-lg p-1" role="tablist">
        {SCHEMES.map((s) => (
          <button key={s} role="tab" aria-selected={scheme === s} onClick={() => setScheme(s)}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors ${scheme === s ? "bg-surface-tertiary text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>
            {t(`expert.verify.scheme.${s}`)}
          </button>
        ))}
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1.5">{t(scheme === "eip712" ? "expert.verify.typedData" : "expert.verify.message")}</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={scheme === "eip712" ? 8 : 4}
          placeholder={t(scheme === "eip712" ? "expert.verify.typedDataPlaceholder" : "expert.verify.messagePlaceholder")} className={`${FIELD} resize-none`} />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1.5">{t("expert.verify.signature")}</label>
        <textarea value={signature} onChange={(e) => setSignature(e.target.value)} rows={2} placeholder={scheme === "solana" ? "base58 / base64 / hex" : "0x…"} className={`${FIELD} resize-none`} />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1.5">{t(scheme === "solana" ? "expert.verify.address" : "expert.verify.expectedOptional")}</label>
        <input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder={scheme === "solana" ? "Solana address" : "0x…"} className={FIELD} />
      </div>

      {result && "error" in result && <ErrorBox><span className="block text-xs break-all">{result.error}</span></ErrorBox>}
      {result && !("error" in result) && <ResultCard result={result} solana={scheme === "solana"} />}
      {scheme !== "solana" && <p className="text-[11px] text-text-muted">{t("expert.verify.eoaOnly")}</p>}
    </div>
  );
}

function ResultCard({ result, solana }: { result: VerifyResult; solana: boolean }) {
  const { t } = useTranslation();
  const ok = result.match === true;
  const tone = result.match === null ? "border-border-primary bg-surface-secondary" : ok ? "border-green-500/20 bg-green-500/10" : "border-red-500/20 bg-red-500/10";
  return (
    <div className={`border rounded-lg px-3 py-2.5 space-y-1.5 ${tone}`} data-testid="verify-result">
      {result.match !== null && (
        <p className={`text-sm font-medium flex items-center gap-1.5 ${ok ? "text-green-400" : "text-red-400"}`}>
          {ok ? <BadgeCheck className="w-4 h-4" /> : <CircleX className="w-4 h-4" />}
          {t(ok ? "expert.verify.match" : solana ? "expert.verify.invalid" : "expert.verify.noMatch")}
        </p>
      )}
      {!solana && (
        <div className="text-xs">
          <span className="text-text-muted">{t("expert.verify.recovered")} </span>
          <span className="font-mono text-text-primary break-all">{result.signer}</span>
        </div>
      )}
    </div>
  );
}
