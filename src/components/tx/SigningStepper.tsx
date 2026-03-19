/** Shared signing progress stepper — used by Send, WC, and XLM trustline dialogs */
export function SigningStepper({ steps, currentIndex, className }: {
  steps: { label: string }[];
  currentIndex: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 max-w-[260px] mx-auto ${className ?? ""}`}>
      {steps.map(({ label }, idx) => {
        const isDone = currentIndex > idx;
        const isCurrent = currentIndex === idx;
        return (
          <div key={idx} className="flex items-center gap-2.5">
            {isDone ? (
              <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : isCurrent ? (
              <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              </div>
            ) : (
              <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-surface-tertiary" />
              </div>
            )}
            <span className={`text-xs ${isDone ? "text-text-tertiary" : isCurrent ? "text-text-primary font-medium" : "text-text-muted"}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
