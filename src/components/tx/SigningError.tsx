// Shared error state for Send/WC/Token Enable signing failures

export function SigningError({
  error,
  title = "Transaction Failed",
  onClose,
  onRetry,
}: {
  error: string;
  title?: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <p className="text-sm font-medium text-text-primary mb-1">{title}</p>
      <p className="text-xs text-red-400 break-all mb-2">{error}</p>
      <p className="text-[10px] text-text-muted mb-5">Check Activity Log in the Advanced menu for details.</p>
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 bg-surface-tertiary hover:bg-border-primary text-text-secondary text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          Close
        </button>
        <button
          onClick={onRetry}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
