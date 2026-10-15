import { useState } from "react";
import { Pencil, Square } from "lucide-react";

import type { Project } from "@/lib/api";
import { SECTIONS, blanks, isBlank, type Brief } from "@/lib/company";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { companyAgent, useAgentOf, useCompany, useCompanyOf } from "@/store/company";
import { useDay } from "@/store/day";
import { useFold } from "@/store/fold";
import { useLiveLast, useLivePhase } from "@/store/live";
import { Markdown } from "../Markdown";
import { ChoicePicker } from "../ModelPicker";
import { BriefSection } from "./BriefSection";
import { SectionHead } from "./SectionHead";

// The brief everything the company does starts from. Read as a page, the way the owner thinks of
// it; edited in place when they ask, and drafted from the project by the company's agent, which
// fills only what's empty and never rewrites what the owner wrote.

function Progress({ runId }: { runId: string }) {
  const phase = useLivePhase(runId) || "Starting";
  const doing = useLiveLast(runId);
  const said = doing ? `${phase} · ${doing}` : phase;
  return (
    <p className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground" title={said}>
      <span className="node-live mr-2 inline-block h-1.5 w-1.5 rounded-full bg-foreground align-middle" />
      {said}
    </p>
  );
}

function DraftBar({ project, brief, runId }: { project: Project; brief: Brief; runId: string | null }) {
  const engines = useApp((s) => s.clis).filter((cli) => cli.installed).map((cli) => cli.engine);
  useAgentOf(project.id);
  const choice = companyAgent(project.id);
  const { draft, stop } = useCompany.getState();
  const left = blanks(brief).length;
  if (!runId && left === 0) return null;
  if (!choice) return <p className="text-[12.5px] text-muted-foreground">Install Claude Code, Codex or Antigravity to draft the brief from the project.</p>;
  const whole = isBlank(brief);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-2.5 py-2">
      {runId ? (
        <>
          <Progress runId={runId} />
          <button type="button" className="flex h-8 flex-none items-center gap-1.5 rounded-md bg-selected px-3 text-[12.5px] transition-colors hover:bg-pressed" onClick={() => stop(project.id)}>
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        </>
      ) : (
        <>
          <ChoicePicker choice={choice} onChoose={(next) => useDay.getState().setAgent(project.id, next)} label="Agent that works for the company" engines={engines} down tunable />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{whole ? "Reads the project, changes nothing." : `${left} ${left === 1 ? "section is" : "sections are"} still empty.`}</span>
          <button type="button" className="h-8 flex-none rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90" onClick={() => void draft(project.id)}>
            {whole ? "Draft it from the project" : "Fill them in"}
          </button>
        </>
      )}
    </div>
  );
}

// Each part shows two lines; a click reads the rest.
function Field({ id, heading, text }: { id: string; heading: string; text: string }) {
  const [open, setOpen] = useFold(id);
  const long = text.length > 140 || text.trim().includes("\n");
  const toggle = () => long && setOpen((v) => !v);
  return (
    <div className="grid gap-1 @[30rem]:grid-cols-[112px_1fr] @[30rem]:gap-6">
      <dt className="pt-px text-[12px] font-medium text-muted-foreground">{heading}</dt>
      <dd
        className={cn("min-w-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring [&_p]:text-[13.5px]", long && "cursor-pointer")}
        role={long ? "button" : undefined}
        tabIndex={long ? 0 : undefined}
        aria-expanded={long ? open : undefined}
        onClick={toggle}
        onKeyDown={(e) => long && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
      >
        <div className={cn(long && !open && "line-clamp-2")}>
          <Markdown source={text} />
        </div>
      </dd>
    </div>
  );
}

function Reading({ projectId, brief }: { projectId: string; brief: Brief }) {
  return (
    <dl className="grid gap-3">
      {SECTIONS.filter((s) => brief[s.key].trim()).map((s) => <Field key={s.key} id={`brief:${projectId}:${s.key}`} heading={s.heading} text={brief[s.key]} />)}
    </dl>
  );
}

export function BriefCard({ project, brief }: { project: Project; brief: Brief }) {
  const { runId, error } = useCompanyOf(project.id);
  const change = useCompany((s) => s.change);
  const [editing, setEditing] = useState(false);
  const writing = editing || isBlank(brief) || runId !== null;
  return (
    <section className="@container grid gap-3">
      <SectionHead title="Brief">
        {!isBlank(brief) && !runId && (
          <button type="button" className={cn("flex h-7 items-center gap-1.5 rounded-md px-3 text-[12.5px] transition-colors", editing ? "bg-foreground text-background hover:opacity-90" : "border border-border text-muted-foreground hover:bg-hover hover:text-foreground")} onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : <><Pencil className="h-3 w-3" />Edit</>}
          </button>
        )}
      </SectionHead>
      {(runId || error || blanks(brief).length > 0) && writing && (
        <div className="grid gap-2">
          <DraftBar project={project} brief={brief} runId={runId} />
          {error && <p className="px-1 text-[12.5px] text-failure">{error}</p>}
        </div>
      )}
      {writing ? (
        <div className="grid gap-8">
          {SECTIONS.map((s) => (
            <BriefSection key={s.key} heading={s.heading} hint={s.hint} example={s.example} value={brief[s.key]} drafting={runId !== null} onChange={(text) => change(project.id, s.key, text)} />
          ))}
        </div>
      ) : (
        <Reading projectId={project.id} brief={brief} />
      )}
    </section>
  );
}
