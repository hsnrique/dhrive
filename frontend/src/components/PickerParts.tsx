import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Gauge } from "lucide-react";

import type { Cli, Engine, ModelOption } from "@/lib/api";
import type { Choice } from "@/lib/flow";
import { cliLabel, effortLabel } from "@/lib/names";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { EngineMark } from "./EngineMark";

// The model picker's three parts, top to bottom: which CLI (tabs), which of its models (the only
// part that scrolls), and its effort, pinned at the bottom so it's always in sight.

const NONE: ModelOption[] = [];

export function CliTabs({ choice, engines, onPick, onSetUp }: { choice: Choice; engines?: Engine[]; onPick: (cli: Cli) => void; onSetUp: () => void }) {
  const all = useApp((s) => s.clis);
  const clis = engines ? all.filter((cli) => engines.includes(cli.engine)) : all;
  // Four don't fit in a row with their names, so they go two by two.
  const columns = clis.length === 4 ? 2 : clis.length;
  return (
    <div role="tablist" aria-label="CLI" className="grid gap-1 border-b border-border p-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {clis.map((cli) => {
        const picked = cli.installed && cli.engine === choice.engine;
        return (
          <button
            key={cli.engine}
            type="button"
            role="tab"
            aria-selected={picked}
            title={cli.installed ? cli.label : `${cli.engine === "ollama" ? "Set up" : "Install"} ${cli.label}`}
            className={cn("flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] transition-colors", picked ? "bg-white/[0.11] text-foreground" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground")}
            onClick={() => (cli.installed ? onPick(cli) : cli.engine === "ollama" ? onSetUp() : void openUrl(cli.docsUrl))}
          >
            <EngineMark engine={cli.engine} className={cn("h-3.5 w-3.5 flex-none", !cli.installed && "opacity-40")} />
            <span className="truncate">{cli.label}</span>
            {!cli.installed && <span className="flex-none text-[10.5px] opacity-70">{cli.engine === "ollama" ? "Set up" : "Get"}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Every model the CLI reported, with the CLI's own one-line description (version, strengths, price).
export function ModelList({ choice, models, onPick, onGetModels }: { choice: Choice; models: ModelOption[] | undefined; onPick: (id: string) => void; onGetModels: () => void }) {
  const clis = useApp((s) => s.clis);
  const local = choice.engine === "ollama";
  const empty = models === undefined ? `Asking ${cliLabel(choice.engine, clis)} for its models…` : local ? "No Ollama models yet." : "";
  return (
    <>
      {(models ?? NONE).length === 0 && empty && <p className="px-2 py-1.5 text-xs text-muted-foreground">{empty}</p>}
      {(models ?? NONE).map((option) => (
        <button
          key={option.id || "default"}
          type="button"
          title={option.detail ?? undefined}
          className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.07]", choice.model === option.id && "bg-white/[0.05]")}
          onClick={() => onPick(option.id)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px]">{option.label}</span>
            {option.detail && <span className="block truncate text-[11px] text-muted-foreground">{option.detail}</span>}
          </span>
          {choice.model === option.id && <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />}
        </button>
      ))}
      {local && (
        <button type="button" className="mx-2 mt-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground" onClick={onGetModels}>
          Get models
        </button>
      )}
    </>
  );
}

// Effort as a meter: the CLI's default, then one bar per level it lists, each taller than the last.
// The name of the level picked (or pointed at) reads on the right.
export function EffortMeter({ efforts, effort, onPick }: { efforts: string[]; effort: string; onPick: (effort: string) => void }) {
  const [pointed, setPointed] = useState<string | null>(null);
  const at = efforts.indexOf(effort);
  const shown = pointed ?? effort;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Gauge className="h-3.5 w-3.5" />
          Effort
        </span>
        <span className={cn(pointed === null ? "text-foreground" : "text-muted-foreground")}>{shown ? effortLabel(shown) : "CLI default"}</span>
      </div>
      <div role="radiogroup" aria-label="Effort" className="flex h-8 items-stretch gap-1" onMouseLeave={() => setPointed(null)}>
        <button type="button" role="radio" aria-checked={at < 0} className={cn("flex-none rounded-md px-2.5 text-[11.5px] transition-colors", at < 0 ? "bg-white/[0.12] text-foreground" : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground")} onMouseEnter={() => setPointed("")} onClick={() => onPick("")}>
          Default
        </button>
        {efforts.map((level, i) => (
          <button key={level} type="button" role="radio" aria-checked={i === at} aria-label={effortLabel(level)} className="group flex min-w-0 flex-1 items-end justify-center rounded-md pb-1 transition-colors hover:bg-white/[0.06]" onMouseEnter={() => setPointed(level)} onClick={() => onPick(level)}>
            <span className={cn("w-3 rounded-[2px] transition-colors", i <= at ? "bg-foreground" : "bg-white/[0.22] group-hover:bg-white/[0.45]")} style={{ height: 6 + (16 * (i + 1)) / efforts.length }} />
          </button>
        ))}
      </div>
    </div>
  );
}
