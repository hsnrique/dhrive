import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, X } from "lucide-react";

import type { Fit, LocalModel, LocalScan } from "@/lib/api";
import { gigabytes } from "@/lib/names";
import { cn } from "@/lib/utils";
import { useLocal, type Pull } from "@/store/local";
import { fieldVariants } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EngineMark } from "./EngineMark";

const FIT: Record<Fit, string> = { good: "Runs well", tight: "Tight fit", "too-big": "Too big for this Mac", "no-disk": "Not enough disk" };
// Ollama's own guidance for coding tools and agents.
const CODING_CONTEXT = 64_000;

function machineLine({ chip, memoryBytes, freeDiskBytes }: LocalScan["machine"]) {
  return [chip, `${Math.round(memoryBytes / 2 ** 30)} GB memory`, `${gigabytes(freeDiskBytes)} free`].filter(Boolean).join(" · ");
}

function NoticeRow({ text, hint, action, onAction }: { text: string; hint?: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 text-[13px]">
      <span className="flex-1">
        {text} {hint && <span className="text-muted-foreground">{hint}</span>}
      </span>
      {action && (
        <Button variant="soft" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

// Only the one thing standing between the owner and a local run, most blocking first.
function Notice({ scan }: { scan: LocalScan }) {
  const openOllama = useLocal((s) => s.openOllama);
  if (scan.ollama === "missing") return <NoticeRow text="Ollama isn't installed." action="Get Ollama" onAction={() => void openUrl("https://ollama.com/download")} />;
  if (scan.ollama === "stopped") return <NoticeRow text="Ollama isn't running." action="Open Ollama" onAction={() => void openOllama()} />;
  if (!scan.codex) return <NoticeRow text="Ollama models run through Codex." action="Install Codex" onAction={() => void openUrl("https://developers.openai.com/codex/cli/")} />;
  if (scan.context !== null && scan.context >= CODING_CONTEXT) return null;
  const text = scan.context === null ? "Coding needs a 64k context." : `Context is ${Math.round(scan.context / 1024)}k; coding needs 64k.`;
  return <NoticeRow text={text} hint="Ollama → Settings → Context length" />;
}

function pullLabel(pull: Pull) {
  if (pull.status === "downloading" && pull.total) return `${Math.floor((pull.completed * 100) / pull.total)}% of ${gigabytes(pull.total)}`;
  if (pull.status.startsWith("verifying")) return "Verifying";
  if (pull.status.startsWith("writing") || pull.status === "success") return "Finishing";
  return "Starting";
}

function PullLine({ pull }: { pull: Pull }) {
  if (pull.error) return <p className="text-[12px] text-failure">{pull.error}</p>;
  const percent = pull.total ? (pull.completed * 100) / pull.total : 0;
  return (
    <div className="flex items-center gap-3" role="progressbar" aria-valuenow={Math.floor(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-[1.5px] flex-1 overflow-hidden rounded-full bg-selected">
        <div className="h-full bg-foreground/80 transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-32 text-right font-mono text-[11px] text-muted-foreground">{pullLabel(pull)}</span>
    </div>
  );
}

function InstallAction({ id, installed, ready, fit }: { id: string; installed: boolean; ready: boolean; fit: Fit }) {
  const pull = useLocal((s) => s.pulls[id]);
  const { install, stop } = useLocal.getState();
  if (installed) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
        <Check className="h-3.5 w-3.5" /> Installed
      </span>
    );
  }
  if (pull && !pull.error) {
    return (
      <Button variant="ghost" title="Stop the download" aria-label={`Stop downloading ${id}`} onClick={() => stop(id)}>
        <X className="h-3.5 w-3.5" /> Stop
      </Button>
    );
  }
  return (
    // Too big stays possible (the owner decides), just not inviting; no disk space can't work.
    <Button variant={fit === "too-big" ? "ghost" : "soft"} disabled={!ready || fit === "no-disk"} onClick={() => void install(id)}>
      Install
    </Button>
  );
}

function FitMark({ fit }: { fit: Fit }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11.5px]", fit === "good" ? "text-foreground" : "text-muted-foreground")}>
      {fit === "good" && <span className="h-1.5 w-1.5 rounded-full bg-foreground/80" />}
      {fit === "tight" && <span className="h-1.5 w-1.5 rounded-full border border-foreground/60" />}
      {FIT[fit]}
    </span>
  );
}

function ModelRow({ model, ready }: { model: LocalModel; ready: boolean }) {
  const pull = useLocal((s) => s.pulls[model.id]);
  return (
    <li className="grid gap-2.5 px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className={cn("text-[13.5px] font-medium", model.fit === "too-big" && !model.installed && "text-muted-foreground")}>{model.label}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {model.id} · {gigabytes(model.bytes)}
          </p>
        </div>
        <FitMark fit={model.fit} />
        <div className="flex w-24 justify-end">
          <InstallAction id={model.id} installed={model.installed} ready={ready} fit={model.fit} />
        </div>
      </div>
      {pull && !model.installed && <PullLine pull={pull} />}
    </li>
  );
}

function AnyModel({ ready }: { ready: boolean }) {
  const [name, setName] = useState("");
  const id = name.trim();
  const pull = useLocal((s) => (id ? s.pulls[id] : undefined));
  const install = useLocal((s) => s.install);
  return (
    <form
      className="mt-4 grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (id) void install(id);
      }}
    >
      <div className="flex gap-2">
        <input
          aria-label="Any Ollama model"
          className={cn(fieldVariants({ size: "lg" }), "flex-1 font-mono text-xs placeholder:font-sans")}
          placeholder="Any model from ollama.com, like granite4.1:8b"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="soft" size="lg" disabled={!ready || !id || (pull !== undefined && !pull.error)}>
          Install
        </Button>
      </div>
      {pull && <PullLine pull={pull} />}
    </form>
  );
}

// Open-weight models for the plan or code step, sized against this Mac before anything downloads.
export function LocalModels() {
  const scan = useLocal((s) => s.scan);
  const refresh = useLocal((s) => s.refresh);
  useEffect(() => void refresh(), [refresh]);
  const ready = scan?.ollama === "running";

  return (
    <div data-tauri-drag-region className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[640px] px-8 pb-16 pt-[68px]">
        <EngineMark engine="ollama" className="h-7 w-7" />
        <h1 className="mt-5 display-title">Models on this Mac.</h1>
        <p className="mt-2 font-mono text-[11.5px] text-muted-foreground">{scan ? machineLine(scan.machine) : "Checking this Mac…"}</p>
        {scan && (
          <>
            <Notice scan={scan} />
            <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
              {scan.models.map((model) => (
                <ModelRow key={model.id} model={model} ready={ready} />
              ))}
            </ul>
            <AnyModel ready={ready} />
          </>
        )}
      </div>
    </div>
  );
}
