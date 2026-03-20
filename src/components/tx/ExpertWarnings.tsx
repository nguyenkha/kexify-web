// Shared expert mode warnings for gas limit / gas price

import { useTranslation } from "react-i18next";

interface ExpertWarningsProps {
  gasLimitOverride?: string;
  maxFeeOverride?: string;
  estimatedGas?: bigint | null;
  baseGasPrice?: bigint | null;
  lowMultiplier?: number;
}

export function ExpertWarnings({
  gasLimitOverride,
  maxFeeOverride,
  estimatedGas,
  baseGasPrice,
  lowMultiplier = 0.8,
}: ExpertWarningsProps) {
  const { t } = useTranslation();
  const warnings: { text: string; level: "red" | "yellow" }[] = [];

  if (gasLimitOverride && /^\d+$/.test(gasLimitOverride) && estimatedGas && BigInt(gasLimitOverride) < estimatedGas) {
    warnings.push({
      text: t("send.gasLimitBelowEstimate", { limit: gasLimitOverride, estimate: estimatedGas.toString() }),
      level: "red",
    });
  }

  if (maxFeeOverride && /^\d+(\.\d+)?$/.test(maxFeeOverride) && baseGasPrice != null) {
    const lowGwei = Number(baseGasPrice) * lowMultiplier / 1e9;
    if (parseFloat(maxFeeOverride) < lowGwei) {
      warnings.push({
        text: t("send.maxFeeBelowNetwork", { fee: maxFeeOverride, min: lowGwei.toFixed(2) }),
        level: "yellow",
      });
    }
  }

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={`${w.level === "red" ? "bg-red-500/10 border-red-500/20" : "bg-yellow-500/5 border-yellow-500/15"} border rounded-lg px-3 py-2`}
        >
          <p className={`text-xs ${w.level === "red" ? "text-red-400" : "text-yellow-500/80"} leading-relaxed`}>
            {w.text}
          </p>
        </div>
      ))}
    </div>
  );
}
