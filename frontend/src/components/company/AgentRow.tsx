import { useState } from "react";
import { Pencil, X } from "lucide-react";

import type { Engine } from "@/lib/api";
import { MAX_NAME, MAX_ROLE, type Agent } from "@/lib/army";
import type { Choice } from "@/lib/flow";
import { useArmy } from "@/store/army";
import { useDay } from "@/store/day";
import { ChoicePicker } from "../ModelPicker";
import { field, pill } from "./EnvRow";

// One agent of the army: its name and role, the CLI and model it works on, and, on hover, edit and
// dismiss. A new CLI or model moves the tasks waiting on it too; a dismissed agent's waiting tasks go
// back to the company's own agent. Dismissing asks once more, by name.

const quiet = "flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground";

export function AgentForm({ initial, onSave, onDone }: { initial?: Pick<Agent, "name" | "role">; onSave: (name: string, role: string) => boolean; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const save = () => name.trim() && onSave(name, role) && onDone();
  return (
    <form className="grid gap-2 border-b border-border py-2.5 pl-1" onSubmit={(e) => (e.preventDefault(), save())}>
      <input autoFocus className={`${field} font-sans`} maxLength={MAX_NAME} value={name} placeholder="Name, like Back or SEO" aria-label="Agent name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <textarea className={`${field} h-20 resize-none py-2 font-sans leading-relaxed`} maxLength={MAX_ROLE} value={role} placeholder="What it owns and how it works" aria-label="Agent role" onChange={(e) => setRole(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <div className="flex items-center justify-end gap-1">
        <button type="button" className="h-7 rounded-md px-2.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={onDone}>Cancel</button>
        <button type="submit" disabled={!name.trim()} className={pill}>Save</button>
      </div>
    </form>
  );
}

export function AgentRow({ projectId, agent, engines }: { projectId: string; agent: Agent; engines: Engine[] }) {
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
  if (editing) return <li><AgentForm initial={agent} onSave={(name, role) => edit(projectId, agent.id, { name, role })} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="group grid gap-1 border-b border-border py-2.5 pl-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{agent.name}</span>
        <ChoicePicker choice={{ engine: agent.engine, model: agent.model, effort: agent.effort }} onChoose={choose} label={`CLI for ${agent.name}`} engines={engines} align="right" down tunable />
      </div>
      {agent.role && <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{agent.role}</p>}
      <div className={leaving ? "flex items-center gap-1.5" : "hidden items-center gap-1.5 group-hover:flex group-focus-within:flex"}>
        {leaving ? (
          <>
            <button type="button" className="h-6 rounded-md border border-[#ff8a8f]/50 px-2.5 text-[11.5px] text-[#ff8a8f] transition-colors hover:bg-[#ff8a8f]/10" onClick={leave}>Dismiss {agent.name}</button>
            <button type="button" className={quiet} onClick={() => setLeaving(false)}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" className={quiet} onClick={() => setEditing(true)}><Pencil className="h-3 w-3" />Edit</button>
            <button type="button" className={quiet} onClick={() => setLeaving(true)}><X className="h-3 w-3" />Dismiss</button>
          </>
        )}
      </div>
    </li>
  );
}
