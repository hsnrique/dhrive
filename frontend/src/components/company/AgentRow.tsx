import { useState } from "react";
import { LifeBuoy, Pencil, X } from "lucide-react";

import type { Engine } from "@/lib/api";
import { MAX_NAME, MAX_OWNS, MAX_ROLE, type Agent } from "@/lib/army";
import type { Choice } from "@/lib/flow";
import { totalDetail, totalLine, type Tokens } from "@/lib/spend";
import { cn } from "@/lib/utils";
import { useArmy } from "@/store/army";
import { useDay } from "@/store/day";
import { buttonVariants } from "@/components/ui/button";
import { fieldVariants } from "@/components/ui/field";
import { ChoicePicker } from "../ModelPicker";
import { saveButton } from "./EnvRow";

const field = fieldVariants({ size: "sm" });

// One agent of the army: its name and role, the CLI and model it works on, and, on hover, edit and
// dismiss. A new CLI or model moves the tasks waiting on it too; a dismissed agent's waiting tasks go
// back to the company's own agent. Dismissing asks once more, by name.

const quiet = cn(buttonVariants({ variant: "ghost", size: "xs" }), "px-2");

export function AgentForm({ initial, onSave, onDone }: { initial?: Pick<Agent, "name" | "role" | "owns">; onSave: (name: string, role: string, owns: string) => boolean; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [owns, setOwns] = useState(initial?.owns ?? "");
  const save = () => name.trim() && onSave(name, role, owns) && onDone();
  return (
    <form className="grid gap-2 border-b border-border py-2.5 pl-1" onSubmit={(e) => (e.preventDefault(), save())}>
      <input autoFocus className={field} maxLength={MAX_NAME} value={name} placeholder="Name, like Back or SEO" aria-label="Agent name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <textarea className={cn(fieldVariants({ size: "area" }), "h-20 resize-none py-2 text-[12px]")} maxLength={MAX_ROLE} value={role} placeholder="What it does and how it works" aria-label="Agent role" onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <input className={field} maxLength={MAX_OWNS} value={owns} placeholder="Folders it owns, like server, api (optional)" aria-label="Folders the agent owns" onChange={(e) => setOwns(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <div className="flex items-center justify-end gap-1">
        <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={!name.trim()} className={saveButton}>Save</button>
      </div>
    </form>
  );
}

export function AgentRow({ projectId, agent, engines, spent }: { projectId: string; agent: Agent; engines: Engine[]; spent?: Tokens }) {
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { edit, dismiss } = useArmy.getState();
  const choose = (choice: Choice) => {
    edit(projectId, agent.id, choice);
    useDay.getState().follow(projectId, agent.id, { ...agent, ...choice });
  };
  const leave = () => {
    dismiss(projectId, agent.id);
    useDay.getState().follow(projectId, agent.id, null);
  };
  if (editing) return <li><AgentForm initial={agent} onSave={(name, role, owns) => edit(projectId, agent.id, { name, role, owns })} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="group grid gap-1 border-b border-border py-2.5 pl-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.name}</span>
        {spent && spent.input + spent.output > 0 && <span className="flex-none font-mono text-[11px] text-muted-foreground" title={`What ${agent.name}'s tasks spent: ${totalDetail(spent)}`}>{totalLine(spent)}</span>}
        <ChoicePicker choice={{ engine: agent.engine, model: agent.model, effort: agent.effort }} onChoose={choose} label={`CLI for ${agent.name}`} engines={engines} align="right" down tunable />
      </div>
      {agent.role && <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{agent.role}</p>}
      {agent.owns && <p className="truncate font-mono text-[11px] text-muted-foreground" title="Changes land only inside these">owns {agent.owns}</p>}
      {agent.fallback && (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground" title="Where it works when its own plan is near its limit">backup</span>
          <ChoicePicker choice={agent.fallback} onChoose={(fallback) => edit(projectId, agent.id, { fallback })} label={`Backup for ${agent.name}`} engines={engines} down tunable />
          <button type="button" className={quiet} title="No backup: it waits for its plan to reset" onClick={() => edit(projectId, agent.id, { fallback: undefined })}><X className="h-3 w-3" /></button>
        </div>
      )}
      <div className={leaving ? "flex items-center gap-1.5" : "hidden items-center gap-1.5 group-hover:flex group-focus-within:flex"}>
        {leaving ? (
          <>
            <button type="button" className="h-6 rounded-md border border-failure/50 px-2.5 text-[11.5px] text-failure transition-colors hover:bg-failure/10" onClick={leave}>Dismiss {agent.name}</button>
            <button type="button" className={quiet} onClick={() => setLeaving(false)}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" className={quiet} onClick={() => setEditing(true)}><Pencil className="h-3 w-3" />Edit</button>
            {!agent.fallback && <button type="button" className={quiet} title="Where it works when its own plan is near its limit: pick another CLI or model" onClick={() => edit(projectId, agent.id, { fallback: { engine: agent.engine, model: agent.model, effort: agent.effort } })}><LifeBuoy className="h-3 w-3" />Backup</button>}
            <button type="button" className={quiet} onClick={() => setLeaving(true)}><X className="h-3 w-3" />Dismiss</button>
          </>
        )}
      </div>
    </li>
  );
}
