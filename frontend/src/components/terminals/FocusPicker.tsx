import { useEffect, useMemo, useState } from "react";
import { Check, Puzzle } from "lucide-react";

import type { Engine } from "@/lib/api";
import type { Focus } from "@/lib/maestro";
import { cn } from "@/lib/utils";
import { connectionsKey, useConnections } from "@/store/connections";
import { useDraft, useMaestro } from "@/store/maestro";

// The skills, MCP servers and plugins the maestro's CLI has in this project, to point it at the ones
// that matter for the brief. Asked fresh on opening; only what's switched on is offered.

const SECTIONS: { kind: Focus["kind"]; label: string }[] = [
  { kind: "skill", label: "Skills" },
  { kind: "server", label: "MCP servers" },
  { kind: "plugin", label: "Plugins" },
];

function useOffered(engine: Engine, folder: string): { offered: Focus[]; loading: boolean; error: string | null } {
  const seen = useConnections((s) => s.seen[connectionsKey(engine, folder)]);
  const offered = useMemo(() => {
    const value = seen?.value;
    if (!value) return [];
    return [
      ...value.skills.filter((s) => s.on).map((s) => ({ kind: "skill" as const, name: s.name })),
      ...value.servers.filter((s) => s.status !== "disabled" && s.status !== "failed").map((s) => ({ kind: "server" as const, name: s.name })),
      ...value.plugins.filter((p) => p.on).map((p) => ({ kind: "plugin" as const, name: p.name })),
    ];
  }, [seen?.value]);
  return { offered, loading: seen?.loading ?? true, error: seen?.error ?? null };
}

const same = (a: Focus, b: Focus) => a.kind === b.kind && a.name === b.name;

function FocusList({ session, offered, filter }: { session: string; offered: Focus[]; filter: string }) {
  const { focus } = useDraft(session);
  const toggle = (item: Focus) => useMaestro.getState().set(session, { focus: focus.some((f) => same(f, item)) ? focus.filter((f) => !same(f, item)) : [...focus, item] });
  const shown = offered.filter((item) => item.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="max-h-72 overflow-y-auto">
      {SECTIONS.map(({ kind, label }) => {
        const items = shown.filter((item) => item.kind === kind);
        if (items.length === 0) return null;
        return (
          <div key={kind}>
            <p className="px-2 pb-1 pt-2 text-[11px] text-muted-foreground">{label}</p>
            {items.map((item) => {
              const on = focus.some((f) => same(f, item));
              return (
                <button key={item.name} type="button" role="menuitemcheckbox" aria-checked={on} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-white/[0.07]" onClick={() => toggle(item)}>
                  <span className={cn("flex h-3.5 w-3.5 flex-none items-center justify-center rounded border border-border", on && "border-foreground bg-foreground text-background")}>{on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}</span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function FocusPicker({ session, engine, folder }: { session: string; engine: Engine; folder: string }) {
  const count = useDraft(session).focus.length;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { offered, loading, error } = useOffered(engine, folder);
  useEffect(() => {
    if (open) void useConnections.getState().refresh(engine, folder);
  }, [open, engine, folder]);
  const empty = loading && offered.length === 0 ? "Asking the CLI what it has…" : error && offered.length === 0 ? error : offered.length === 0 ? "Nothing connected here." : null;
  return (
    <div className="relative">
      <button type="button" aria-haspopup="dialog" aria-expanded={open} title="Skills, MCP servers and plugins to use" className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs transition-colors hover:bg-white/[0.08]", count ? "text-foreground" : "text-muted-foreground")} onClick={() => setOpen((v) => !v)}>
        <Puzzle className="h-3.5 w-3.5" />
        {count ? `Using ${count}` : "Use…"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Skills, MCP servers and plugins" className="pop-in absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-border bg-popover shadow-popover p-1.5">
            <input autoFocus aria-label="Filter" placeholder="Filter" value={filter} className="mx-0.5 mb-1 h-8 w-[calc(100%-4px)] rounded-lg border border-border bg-black/30 px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring" onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
            {empty ? <p className="px-2 py-2 text-xs text-muted-foreground">{empty}</p> : <FocusList session={session} offered={offered} filter={filter} />}
          </div>
        </>
      )}
    </div>
  );
}
