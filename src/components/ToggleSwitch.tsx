export function ToggleSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-8 h-[18px] rounded-full transition-colors shrink-0 ${
        on ? "bg-blue-500" : "bg-surface-tertiary"
      }`}
    >
      <span
        className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
          on ? "left-[16px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}
