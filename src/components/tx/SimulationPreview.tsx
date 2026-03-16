// Shared simulation result display for Send/WC preview

import type { SimulationResult } from "../../lib/txSimulation";

export function SimulationPreview({ simResult }: { simResult: SimulationResult }) {
  if (simResult.changes.length === 0) return null;

  return (
    <div>
      <div className="bg-surface-primary border border-border-primary rounded-lg overflow-hidden">
        {simResult.changes.map((c, i) => (
          <div key={i} className={i > 0 ? "border-t border-border-secondary" : ""}>
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-text-muted">{c.asset.symbol}</span>
              <span className={`text-[11px] tabular-nums font-medium ${c.direction === "out" ? "text-red-400" : "text-green-400"}`}>
                {c.direction === "out" ? "-" : "+"}{c.amount}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-text-muted/50 mt-1.5 text-right">
        Simulated via {simResult.provider.charAt(0).toUpperCase() + simResult.provider.slice(1)}
      </p>
    </div>
  );
}
