// Shared expert mode "Advanced" inputs for EVM / BTC / BCH

interface EvmAdvancedProps {
  type: "evm";
  nonceOverride: string;
  onNonceChange: (v: string) => void;
  noncePlaceholder: string;
  gasLimitOverride: string;
  onGasLimitChange: (v: string) => void;
  gasLimitPlaceholder: string;
  maxFeeOverride: string;
  onMaxFeeChange: (v: string) => void;
  maxFeePlaceholder: string;
  priorityFeeOverride: string;
  onPriorityFeeChange: (v: string) => void;
  priorityFeePlaceholder: string;
  nonceReadOnly?: boolean;
}

interface BtcAdvancedProps {
  type: "btc" | "ltc" | "bch";
  feeRateOverride: string;
  onFeeRateChange: (v: string) => void;
  feeRatePlaceholder: string;
}

type ExpertAdvancedProps = EvmAdvancedProps | BtcAdvancedProps;

const inputClass = "w-full bg-surface-primary border border-border-primary rounded-lg px-2.5 py-1.5 text-xs text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-blue-500 transition-colors";

export function ExpertAdvanced(props: ExpertAdvancedProps) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Advanced</p>
      {props.type === "evm" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-text-muted mb-1">Nonce</label>
            <input
              value={props.nonceOverride}
              onChange={(e) => props.onNonceChange(e.target.value)}
              readOnly={props.nonceReadOnly}
              placeholder={props.noncePlaceholder}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Gas limit</label>
            <input
              value={props.gasLimitOverride}
              onChange={(e) => props.onGasLimitChange(e.target.value)}
              placeholder={props.gasLimitPlaceholder}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Max fee (Gwei)</label>
            <input
              value={props.maxFeeOverride}
              onChange={(e) => props.onMaxFeeChange(e.target.value)}
              placeholder={props.maxFeePlaceholder}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Priority fee (Gwei)</label>
            <input
              value={props.priorityFeeOverride}
              onChange={(e) => props.onPriorityFeeChange(e.target.value)}
              placeholder={props.priorityFeePlaceholder}
              className={inputClass}
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-xs text-text-muted mb-1">Fee rate (sat/vB)</label>
          <input
            value={props.feeRateOverride}
            onChange={(e) => props.onFeeRateChange(e.target.value)}
            placeholder={props.feeRatePlaceholder}
            className={inputClass}
          />
        </div>
      )}
    </div>
  );
}
