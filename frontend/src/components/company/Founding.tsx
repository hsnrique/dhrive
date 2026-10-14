import { useState, type ReactNode } from "react";
import { Check, Dices, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { companyAgent, useCompany } from "@/store/company";
import { useFounding, type Phase } from "@/store/founding";
import { Approvals } from "../Approvals";
import { ChoicePicker } from "../ModelPicker";
import { Switch } from "../ui/switch";

// Where a company starts: one sentence, or none at all, and dhrive founds it. While it works, what it
// does is on screen, the current step with what its agent is doing right now.

// The founding hands off on the last step: the first delivery is worked on the company's own page.
const STEPS: { phase: Phase | "building"; label: string }[] = [
  { phase: "naming", label: "Looking around, naming it and writing its brief" },
  { phase: "planning", label: "Planning its first delivery" },
  { phase: "building", label: "Building your autonomous company" },
];

const primary = "h-9 flex-none rounded-md bg-foreground px-5 text-[13.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40";
const quiet = "flex h-9 flex-none items-center gap-2 rounded-md px-4 text-[13.5px] text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground";

function Live({ runId }: { runId: string | null }) {
  const phase = useApp((s) => (runId ? s.live[runId]?.phase : undefined)) || "Starting";
  const doing = useApp((s) => (runId ? s.live[runId]?.log[s.live[runId].log.length - 1] : undefined));
  const said = doing ? `${phase} · ${doing}` : phase;
  return <p className="truncate text-[12.5px] text-muted-foreground" title={said}>{said}</p>;
}

function Step({ label, state, children }: { label: string; state: "done" | "now" | "next"; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[18px_1fr] gap-x-3 gap-y-1.5">
      <span className={cn("mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full", state === "done" ? "bg-foreground text-background" : state === "next" && "border border-border")}>
        {state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : state === "now" && <span className="node-live h-2 w-2 rounded-full bg-foreground" />}
      </span>
      <span className={cn("text-[14px]", state === "next" && "text-muted-foreground")}>{label}</span>
      {children && <div className="col-start-2 grid gap-2">{children}</div>}
    </li>
  );
}

function Working() {
  const { phase, name, idea, ask, runId, projectId, error } = useFounding();
  const { stop, reset, start } = useFounding.getState();
  const at = STEPS.findIndex((s) => s.phase === phase);
  const failed = phase === "failed";
  return (
    <div className="grid gap-8">
      <h1 className="font-serif text-[46px] leading-[1.04] tracking-[-0.01em]">{name || (idea ? "Founding your company" : "Finding a company worth starting")}</h1>
      <ol className="grid gap-4">
        {STEPS.map((s, i) => (
          <Step key={s.phase} label={s.label} state={i < at ? "done" : i === at ? "now" : "next"}>
            {i === at && (
              <>
                <Live runId={runId} />
                <Approvals projectId={projectId ?? undefined} runId={runId} />
              </>
            )}
          </Step>
        ))}
      </ol>
      {failed && <p className="text-[13px] text-[#ff8a8f]">{error}</p>}
      <div className="flex items-center gap-2">
        {failed ? (
          <>
            {!projectId && <button type="button" className={primary} onClick={() => void start(idea, ask)}>Try again</button>}
            <button type="button" className={quiet} onClick={reset}>Start over</button>
          </>
        ) : (
          <button type="button" className={quiet} onClick={stop}><Square className="h-3 w-3 fill-current" />Stop</button>
        )}
      </div>
    </div>
  );
}

// Who does the work, picked before anything starts: it founds the company and keeps working for it.
function AgentPicker() {
  useCompany((s) => s.choice);
  const engines = useApp((s) => s.clis).filter((cli) => cli.installed).map((cli) => cli.engine);
  const agent = companyAgent();
  if (!agent) return null;
  return <ChoicePicker choice={agent} onChoose={useCompany.getState().choose} label="Agent that works for the company" engines={engines} down tunable />;
}

function Ask() {
  const [idea, setIdea] = useState("");
  // Off unless the owner wants each task to wait for them; it stays the company's Ask first after.
  const [ask, setAsk] = useState(false);
  const start = useFounding((s) => s.start);
  const go = () => idea.trim() && void start(idea, ask);
  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <h1 className="font-serif text-[46px] leading-[1.04] tracking-[-0.01em]">What company should exist?</h1>
        <p className="max-w-[48ch] text-[14px] leading-relaxed text-muted-foreground">Say it in a sentence, or let dhrive pick. It creates the company and runs it.</p>
      </div>
      <div className="@container grid gap-2 rounded-[22px] border border-border bg-card p-2 focus-within:border-ring">
        <textarea
          autoFocus
          rows={3}
          value={idea}
          maxLength={2000}
          aria-label="The company in a sentence"
          placeholder="A tool that cancels the subscriptions people forget they pay for"
          className="w-full resize-none bg-transparent px-3 py-2 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              go();
            }
          }}
        />
        {/* One line at every width: when the card narrows (a docked sidebar, a long model name), the
            surprise gives up its words and keeps its dice, named on hover. */}
        <div className="flex items-center gap-2 pl-1">
          <AgentPicker />
          <div className="ml-auto flex flex-none items-center gap-2">
            <button type="button" title="Let dhrive surprise you" aria-label="Let dhrive surprise you" className={quiet} onClick={() => void start("", ask)}>
              <Dices className="h-4 w-4 flex-none" strokeWidth={1.75} />
              <span className="hidden @[36rem]:inline">Let dhrive surprise you</span>
            </button>
            <button type="button" disabled={!idea.trim()} className={primary} onClick={go}>
              Start the company
            </button>
          </div>
        </div>
      </div>
      {/* Under the card, not in it: the card's one line is the agent and the two ways to start. */}
      <div className="-mt-4 pl-1">
        <Switch on={ask} label="Ask first" title={ask ? "Every task waits for your OK" : "It starts working right away"} onChange={setAsk} />
      </div>
    </div>
  );
}

export function Founding() {
  const idle = useFounding((s) => s.phase === "idle");
  return idle ? <Ask /> : <Working />;
}
