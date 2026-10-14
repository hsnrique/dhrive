import { useEffect, useState } from "react";

import type { Project } from "@/lib/api";
import { useEnv } from "@/store/env";
import { EnvRow, MissingRow, field, pill } from "./EnvRow";
import { SectionHead } from "./SectionHead";

// The keys and settings the company's code reads, kept in this Mac's Keychain and never in the repo
// (env.rs). What its .env.example names and isn't set yet is marked missing; a removed one can be
// put back from the line under the list.

function AddForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const kept = await useEnv.getState().set(projectId, name, value);
    setSaving(false);
    if (kept) onDone();
  };
  return (
    <form className="flex flex-wrap items-center gap-2 border-b border-border py-2 pl-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input autoFocus spellCheck={false} autoCapitalize="characters" className={`${field} w-[40%] min-w-[140px]`} value={name} placeholder="NAME" aria-label="Variable name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <input type="password" autoComplete="off" spellCheck={false} className={`${field} min-w-[140px] flex-1`} value={value} placeholder="Value" aria-label="Value" onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className="h-7 rounded-md px-2.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={onDone}>Cancel</button>
        <button type="submit" disabled={!name.trim() || saving} className={pill}>Save</button>
      </div>
    </form>
  );
}

export function Environment({ project }: { project: Project }) {
  const view = useEnv((s) => s.byProject[project.id]);
  const error = useEnv((s) => s.errorOf[project.id]);
  const [adding, setAdding] = useState(false);
  useEffect(() => void useEnv.getState().load(project.id), [project.id]);
  if (!view && !error) return null;
  const empty = view && view.vars.length === 0 && view.missing.length === 0;
  return (
    <section className="grid gap-3">
      <SectionHead title="Environment">
        {!adding && <button type="button" className={pill} onClick={() => setAdding(true)}>Add a variable</button>}
      </SectionHead>
      <p className="-mt-1 text-[11.5px] text-muted-foreground">In your Mac's Keychain, never in the repo.</p>
      {error && <p className="text-[12px] text-[#ff8a8f]" role="alert">{error}</p>}
      {view && (
        <ul className="grid">
          {adding && <AddForm projectId={project.id} onDone={() => setAdding(false)} />}
          {view.missing.map((name) => <MissingRow key={`missing-${name}`} projectId={project.id} name={name} />)}
          {view.vars.map((v) => <EnvRow key={v.name} projectId={project.id} name={v.name} hint={v.hint} isPublic={v.public} />)}
          {empty && !adding && <li className="px-1 py-2 text-[12px] text-muted-foreground">No variables yet.</li>}
        </ul>
      )}
      {view && view.removed.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
          Put back:
          {view.removed.map((name) => (
            <button key={name} type="button" title={`Put ${name} back`} className="font-mono underline-offset-4 hover:text-foreground hover:underline" onClick={() => void useEnv.getState().restore(project.id, name)}>
              {name}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}
