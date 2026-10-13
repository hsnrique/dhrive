import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

// A field for a new name: Enter or leaving it saves, Escape keeps the old one. Blank or unchanged
// saves nothing. `onDone` runs either way, to put the name back in place.
export function NameInput({ value, label, onSave, onDone, className }: { value: string; label: string; onSave: (value: string) => void; onDone: () => void; className?: string }) {
  const cancelled = useRef(false);
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={value}
      className={cn("h-7 rounded-md border border-ring bg-black/30 px-2 outline-none", className)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        onDone();
        const next = e.target.value.trim();
        if (!cancelled.current && next && next !== value) onSave(next);
        cancelled.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// A name that becomes a text field on click.
export function InlineEdit({ value, label, onSave, className, inputClassName }: { value: string; label: string; onSave: (value: string) => void; className?: string; inputClassName?: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <NameInput value={value} label={label} onSave={onSave} onDone={() => setEditing(false)} className={inputClassName} />;
  return (
    <button type="button" title={`Rename (${value})`} className={cn("truncate rounded-md px-1 text-left hover:bg-white/[0.06]", className)} onClick={() => setEditing(true)}>
      {value}
    </button>
  );
}
