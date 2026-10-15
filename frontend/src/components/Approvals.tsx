import { useEffect, useState } from "react";
import { ShieldCheck, ShieldQuestion, X } from "lucide-react";

import { disallowInProject, type Project, type Question } from "@/lib/api";
import { asking, ruleLabel } from "@/lib/approvals";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { answer, type Answer } from "@/store/runs";

// Claude Code asks before a tool call it isn't allowed to make on its own; the run waits here for
// the owner, the way Claude Code itself asks: once, always in this project, or no.

const NO_QUESTIONS: Question[] = [];

function Choice({ label, title, onClick, primary }: { label: string; title?: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      className={cn("min-w-0 truncate rounded-lg px-2.5 py-1 text-[12px] transition-colors", primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border hover:bg-white/[0.08]")}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Card({ projectId, runId, question }: { projectId: string | undefined; runId: string; question: Question }) {
  const reply = (choice: Answer) => void answer(projectId, runId, question, choice);
  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-border bg-white/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-[12.5px]">
        <ShieldQuestion className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        Claude {asking(question)}
      </p>
      {question.detail && <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-black/45 px-2.5 py-1.5 font-mono text-[12px] leading-relaxed [font-variant-ligatures:none]">{question.detail}</pre>}
      {question.description && question.description !== question.detail && <p className="text-[12px] text-muted-foreground">{question.description}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Choice label="Allow" primary onClick={() => reply("once")} />
        {question.rule && <Choice label={`Always allow ${ruleLabel(question.rule)} here`} title={`Keep ${question.rule} allowed in this project`} onClick={() => reply("always")} />}
        <Choice label="Deny" onClick={() => reply("deny")} />
      </div>
    </div>
  );
}

export function Approvals({ projectId, runId }: { projectId: string | undefined; runId: string | null }) {
  const questions = useApp((s) => (runId ? s.approvals[runId] : undefined) ?? NO_QUESTIONS);
  if (!runId) return null;
  return (
    <>
      {questions.map((question) => (
        <Card key={question.id} projectId={projectId} runId={runId} question={question} />
      ))}
    </>
  );
}

// What this project always allows, and a way to take each one back.
export function AllowedRules({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const rules = project.allowed ?? [];
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  if (rules.length === 0) return null;
  const remove = async (rule: string) => {
    try {
      const changed = await disallowInProject(project.id, rule);
      useApp.setState((state) => ({ projects: state.projects.map((p) => (p.id === changed.id ? changed : p)) }));
    } catch (error) {
      useApp.getState().reportError(error);
    }
  };
  return (
    <div className="relative">
      <button type="button" title="What Claude may do here without asking" className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" onClick={() => setOpen((v) => !v)}>
        <ShieldCheck className="h-3.5 w-3.5" />
        {rules.length}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Always allowed" className="pop-in absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-border bg-popover shadow-popover p-1.5">
            <p className="px-2 pb-1 pt-1 text-[11px] text-muted-foreground">Always allowed in {project.name}</p>
            {rules.map((rule) => (
              <div key={rule} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] hover:bg-white/[0.05]" title={rule}>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] [font-variant-ligatures:none]">{rule}</span>
                <button type="button" aria-label={`Stop allowing ${rule}`} className="flex-none text-muted-foreground hover:text-foreground" onClick={() => void remove(rule)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
