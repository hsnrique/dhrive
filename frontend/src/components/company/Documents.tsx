import { useEffect } from "react";
import { ChevronDown, Map as MapIcon, Palette, Target, TrendingUp, type LucideIcon } from "lucide-react";

import type { Project } from "@/lib/api";
import { DOCUMENTS, missing, preview, type DocumentId } from "@/lib/documents";
import { cn } from "@/lib/utils";
import { companyAgent, useAgentOf } from "@/store/company";
import { useDay } from "@/store/day";
import { useDocuments, writing } from "@/store/documents";
import { useFold } from "@/store/fold";
import { Markdown } from "../Markdown";
import { SectionHead } from "./SectionHead";

// The company's documents: one line each, its name and its first line, opened to read right under it.
// One not written yet is a task away, and the agent writes it from the brief and the project; the
// lines read again as tasks finish.

const ICONS: Record<DocumentId, LucideIcon> = { mission: Target, roadmap: MapIcon, "design-guide": Palette, "market-research": TrendingUp };

const pill = "h-6 flex-none rounded-md bg-white/[0.08] px-2.5 text-[11.5px] font-medium transition-colors hover:bg-white/[0.14] disabled:opacity-40";

function DocRow({ projectId, kind, text, can }: { projectId: string; kind: (typeof DOCUMENTS)[number]; text: string | null | undefined; can: boolean }) {
  const [open, setOpen] = useFold(`doc:${projectId}:${kind.id}`);
  const Icon = ICONS[kind.id];
  const busy = writing(projectId, kind.id);
  const shown = open && text;
  const toggle = () => text && setOpen(!shown);
  return (
    <li className="border-b border-border last:border-0">
      <div
        className={cn("flex min-h-10 min-w-0 items-center gap-2.5 rounded-md px-1 py-2 outline-none focus-visible:ring-1 focus-visible:ring-ring", text && "cursor-pointer hover:bg-white/[0.03]")}
        role={text ? "button" : undefined}
        tabIndex={text ? 0 : undefined}
        aria-expanded={text ? Boolean(shown) : undefined}
        onClick={toggle}
        onKeyDown={(e) => text && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
      >
        <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
        <span className="flex-none text-[13px]">{kind.title}</span>
        {text ? (
          <>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{preview(text)}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 flex-none text-muted-foreground transition-transform", shown && "rotate-180")} />
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{busy ? "Being written" : "Not written yet"}</span>
            {busy ? <span className="node-live h-1.5 w-1.5 flex-none rounded-full bg-foreground" /> : (
              <button type="button" disabled={!can} className={pill} onClick={() => useDocuments.getState().write(projectId, [kind.id])}>Write it</button>
            )}
          </>
        )}
      </div>
      {shown && (
        <article className="mb-3 ml-[26px] max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-card px-4 py-3">
          <p className="mb-2 text-[11px] text-muted-foreground">{kind.file}</p>
          <Markdown source={text} />
        </article>
      )}
    </li>
  );
}

export function Documents({ project }: { project: Project }) {
  const written = useDocuments((s) => s.byProject[project.id]);
  const done = useDay((s) => s.byProject[project.id]?.tasks.filter((t) => t.status === "done").length ?? 0);
  // Re-rendered as tasks start and stop, so "Writing" shows on the right cards.
  useDay((s) => s.byProject[project.id]?.tasks);
  useAgentOf(project.id);
  useEffect(() => void useDocuments.getState().load(project.id), [project.id, done]);
  if (!written) return null;
  const { write } = useDocuments.getState();
  const absent = missing(written).filter((kind) => !writing(project.id, kind.id));
  const can = Boolean(companyAgent(project.id));
  return (
    <section className="grid gap-3">
      <SectionHead title="Documents">
        {absent.length > 1 && (
          <button type="button" disabled={!can} className={pill} onClick={() => write(project.id, absent.map((k) => k.id))}>
            Write the missing {absent.length}
          </button>
        )}
      </SectionHead>
      <ul className="grid">
        {DOCUMENTS.map((kind) => (
          <DocRow key={kind.id} projectId={project.id} kind={kind} text={written[kind.id]} can={can} />
        ))}
      </ul>
    </section>
  );
}
