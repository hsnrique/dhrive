import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// One section of the brief, written in place: no box until the owner points at it or types, and the
// field grows with what's written, so the page reads like a document.

interface Props {
  heading: string;
  hint: string;
  example: string;
  value: string;
  drafting: boolean;
  onChange: (text: string) => void;
}

export function BriefSection({ heading, hint, example, value, drafting, onChange }: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  // WebKit has no field-sizing yet; the field takes the height of what it holds.
  useLayoutEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value, drafting]);
  const id = `brief-${heading.toLowerCase()}`;
  return (
    <section className="grid gap-1.5">
      <div className="flex items-baseline gap-3">
        <label htmlFor={id} className="text-[14px] font-semibold tracking-[-0.02em]">
          {heading}
        </label>
        <span className="truncate text-[12px] text-muted-foreground">{hint}</span>
      </div>
      {drafting && !value ? (
        <div className="ghost-sweep -mx-3 grid gap-2 rounded-xl px-3 py-3" aria-hidden>
          <span className="h-2.5 w-11/12 rounded-full bg-selected" />
          <span className="h-2.5 w-3/5 rounded-full bg-white/[0.05]" />
        </div>
      ) : (
        <textarea
          id={id}
          ref={field}
          rows={1}
          value={value}
          placeholder={`For example: ${example}`}
          spellCheck
          className={cn(
            "-mx-3 w-[calc(100%+1.5rem)] resize-none overflow-hidden rounded-xl border border-transparent bg-transparent px-3 py-2 text-[14.5px] leading-[1.65] outline-none transition-colors",
            "placeholder:text-muted-foreground hover:bg-hover focus:border-border focus:bg-black/30",
          )}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </section>
  );
}
