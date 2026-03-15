export function SkeletonRow() {
  return (
    <div className="flex items-center h-[68px] px-5 animate-pulse">
      <div className="flex items-center gap-3 flex-1">
        <div className="w-9 h-9 rounded-full bg-surface-tertiary" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-24 bg-surface-tertiary rounded" />
          <div className="h-2.5 w-32 bg-surface-tertiary/60 rounded" />
        </div>
      </div>
      <div className="space-y-1.5 text-right">
        <div className="h-3.5 w-20 bg-surface-tertiary rounded ml-auto" />
        <div className="h-2.5 w-12 bg-surface-tertiary/60 rounded ml-auto" />
      </div>
    </div>
  );
}
