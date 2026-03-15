import { useState } from "react";

export function KeyNameLabel({
  keyId,
  name,
  onRename,
  disabled,
}: {
  keyId: string;
  name: string | null;
  onRename: (name: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name ?? "");

  function save() {
    const trimmed = draft.trim();
    onRename(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder={`Key ${keyId.slice(0, 8)}...`}
        className="text-[10px] uppercase tracking-wider font-semibold bg-transparent border-b border-border-primary text-text-primary outline-none px-0 py-0.5 w-40"
      />
    );
  }

  if (disabled) {
    return (
      <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
        {name || `Key ${keyId.slice(0, 8)}...`}
      </span>
    );
  }

  return (
    <button
      onClick={() => { setDraft(name ?? ""); setEditing(true); }}
      className="text-[10px] text-text-muted uppercase tracking-wider font-semibold cursor-pointer hover:text-text-secondary transition-colors flex items-center gap-1 group/name"
    >
      {name || `Key ${keyId.slice(0, 8)}...`}
      <svg className="w-2.5 h-2.5 opacity-0 group-hover/name:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
      </svg>
    </button>
  );
}
