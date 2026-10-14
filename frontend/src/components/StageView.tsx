import { useEffect, useRef, useState } from "react";
import { Check, Copy, RotateCcw, ShieldAlert, Square, X } from "lucide-react";

import type { Step } from "@/lib/api";
import { cliLabel } from "@/lib/names";
import type { RunMessage, Stage, StageStatus } from "@/lib/thread";
import { formatElapsed, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useApp, useModelName } from "@/store/app";
import { folderOf, projectOf } from "@/store/conversations";
import { retry, stop } from "@/store/runs";
import { Approvals } from "./Approvals";
import { ChangesView } from "./ChangesView";
import { EngineMark } from "./EngineMark";
import { LiveEdits } from "./LiveEdits";
import { useFileSpans } from "./Mentions";
import { Markdown } from "./Markdown";
import { PlanReview } from "./PlanReview";

const PLAN_PREVIEW_LINES = 14;

function StatusNode({ status }: { status: StageStatus }) {
  const base = "relative z-10 flex h-[13px] w-[13px] items-center justify-center rounded-full";
  if (status === "running") return <span className={cn(base, "node-live bg-foreground")} />;
  if (status === "done") return <span className={cn(base, "bg-foreground/85 text-background")}><Check className="h-2.5 w-2.5" strokeWidth={3.5} /></span>;
  if (status === "failed") return <span className={cn(base, "bg-destructive text-white")}><X className="h-2.5 w-2.5" strokeWidth={3.5} /></span>;
  if (status === "stopped" || status === "interrupted") return <span className={cn(base, "border border-foreground/40 bg-background")}><Square className="h-1.5 w-1.5 fill-foreground/60 text-transparent" /></span>;
  return <span className={cn(base, "border bg-background", status === "skipped" ? "border-dashed border-foreground/25" : "border-foreground/35")} />;
}

function LiveLog({ runId, folder }: { runId: string | null; folder: string | undefined }) {
  const live = useApp((s) => (runId ? s.live[runId] : undefined));
  const asking = useApp((s) => (runId ? (s.approvals[runId]?.length ?? 0) > 0 : false));
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [live?.log]);
  return (
    <div className="grid gap-1.5">
      <p className={cn("text-[13px] text-foreground/80", asking && "text-attention")}>{asking ? "Waiting for your OK" : live?.phase || "Starting…"}</p>
      {live && live.log.length > 0 && (
        <pre ref={box} className={cn("max-h-44 overflow-hidden whitespace-pre-wrap font-mono text-[11.5px] leading-[1.6] text-muted-foreground", live.log.length > 8 && "log-fade pt-5")}>
          {live.log.slice(-60).join("\n")}
        </pre>
      )}
      <LiveEdits runId={runId} folder={folder} />
    </div>
  );
}

// A plan waiting for the owner's OK opens whole, since it's there to be read.
function Output({ step, stage, folder, open }: { step: Step; stage: Stage; folder: string | undefined; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const renderCode = useFileSpans(folder);
  const long = step === "plan" && stage.output.split("\n").length > PLAN_PREVIEW_LINES;
  const clipped = long && !expanded;
  return (
    <div className="grid gap-2">
      <div className={cn("relative", clipped && "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_70%,transparent)]")}>
        <Markdown source={stage.output} renderCode={renderCode} />
      </div>
      {long && (
        <button type="button" className="justify-self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show the whole plan"}
        </button>
      )}
    </div>
  );
}

const NOTES: Partial<Record<StageStatus, string>> = {
  skipped: "Didn't run, because the plan didn't finish.",
  held: "Waiting for your answers. Reply below and the plan picks up from there.",
  declined: "Not coded: a newer plan replaced this one.",
  stopped: "Stopped.",
  interrupted: "dhrive closed while this was running.",
};

// A code stage waiting on its plan says what it waits for: the plan, the owner's OK, or its turn.
function waitingNote(message: RunMessage, autoCode: boolean) {
  if (!message.plan) return "Starting…";
  if (message.plan.status === "done") return "Approved. Starts when what's running ends.";
  return autoCode ? "Starts when the plan is done." : "Starts once you approve the plan.";
}

function Body({ step, message, folder }: { step: Step; message: RunMessage; folder: string | undefined }) {
  const stage = message[step]!;
  const autoCode = useApp((s) => s.autoCode);
  if (stage.status === "running") return <LiveLog runId={stage.runId} folder={folder} />;
  if (stage.status === "waiting" && (message.chat || step === "code")) return <p className="text-[13px] text-muted-foreground">{message.chat ? "Starting…" : waitingNote(message, autoCode)}</p>;
  if (stage.status === "done") return <Output step={step} stage={stage} folder={folder} open={step === "plan" && message.code.status === "review"} />;
  if (stage.status === "failed") return <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#ff8a8f]">{stage.error}</p>;
  return <p className="text-[13px] text-muted-foreground">{NOTES[stage.status]}</p>;
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground">
      {children}
    </button>
  );
}

function Actions({ conversationId, message, step, stage }: { conversationId: string; message: RunMessage; step: Step; stage: Stage }) {
  const [copied, setCopied] = useState(false);
  if (stage.status === "running") return <IconButton title="Stop" onClick={() => stop(conversationId)}><Square className="h-3 w-3 fill-current" /></IconButton>;
  if (["failed", "stopped", "interrupted"].includes(stage.status)) {
    return <IconButton title="Run this step again" onClick={() => void retry(conversationId, message.id, step)}><RotateCcw className="h-3.5 w-3.5" /></IconButton>;
  }
  if (stage.status === "done" && (step === "plan" || message.chat)) {
    const copy = () => navigator.clipboard.writeText(stage.output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
    return <IconButton title={message.chat ? "Copy the reply" : "Copy the plan"} onClick={() => void copy()}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</IconButton>;
  }
  return null;
}

// What the CLI wouldn't let the model do in this step, so a reply like "I couldn't run the tests" has
// its reason next to it.
function Blocked({ stage, readOnly }: { stage: Stage; readOnly: boolean }) {
  if (!stage.blocked?.length) return null;
  const why = readOnly ? "This step only reads, so the CLI refused these." : "The CLI refused these for this step.";
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[12px] text-muted-foreground" title={why}>
      <ShieldAlert className="mt-px h-3.5 w-3.5 flex-none" />
      <span className="min-w-0">
        Blocked{readOnly ? " (read-only)" : ""}: <span className="font-mono text-[11.5px] [font-variant-ligatures:none]">{stage.blocked.join(" · ")}</span>
      </span>
    </p>
  );
}

// One step of a request: the node on the relay line, who ran it, what it is doing or made.
export function StageView({ conversationId, message, step, handedOff }: { conversationId: string; message: RunMessage; step: Step; handedOff: boolean | null }) {
  const stage = message[step]!;
  const clis = useApp((s) => s.clis);
  const modelLabel = useModelName(stage.engine, stage.model);
  const now = useNow(stage.status === "running");
  const elapsed = stage.startedAt ? (stage.endedAt ?? now) - stage.startedAt : null;

  return (
    <div className="grid grid-cols-[13px_minmax(0,1fr)] gap-x-3.5">
      <div className="relative flex justify-center pt-[5px]">
        <StatusNode status={stage.status} />
        {handedOff !== null && (
          <span className={cn("absolute bottom-[-6px] left-1/2 top-[22px] w-[1.5px] -translate-x-1/2", !handedOff && "border-l-[1.5px] border-dashed border-white/15")}>
            {handedOff && <span className="relay-fill absolute inset-0 rounded-full bg-foreground/80" />}
          </span>
        )}
      </div>
      <div className="min-w-0 pb-5">
        <header className="flex min-h-6 items-center gap-2">
          <span className="text-[13px] font-medium">{step === "plan" ? "Plan" : message.chat ? "Chat" : "Code"}</span>
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px] text-foreground/80">
            <EngineMark engine={stage.engine} className="h-3 w-3" />
            <span className="truncate">{modelLabel}</span>
            <span className="text-muted-foreground">· {cliLabel(stage.engine, clis)}</span>
          </span>
          {stage.resumed && <span className="text-[11px] text-muted-foreground" title="Continued this CLI's session from the last request">continued</span>}
          {stage.edited && <span className="text-[11px] text-muted-foreground" title="You changed this plan before approving it; the coder got your version">edited</span>}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">{elapsed !== null ? formatElapsed(elapsed) : ""}</span>
          <Actions conversationId={conversationId} message={message} step={step} stage={stage} />
        </header>
        <div className="mt-2">
          {stage.status === "review" ? <PlanReview conversationId={conversationId} message={message} /> : <Body step={step} message={message} folder={folderOf(conversationId)} />}
        </div>
        {stage.status === "running" && <Approvals projectId={projectOf(conversationId)} runId={stage.runId} />}
        <Blocked stage={stage} readOnly={step === "plan" || Boolean(message.chat)} />
        {step === "code" && <ChangesView conversationId={conversationId} message={message} />}
      </div>
    </div>
  );
}
