import { useState } from "react";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";

import { envReveal } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEnv } from "@/store/env";
import { buttonVariants } from "@/components/ui/button";
import { fieldVariants } from "@/components/ui/field";

// One variable on one line: its name, the last four characters of its value, and what can be done
// with it. The value itself comes up from the Keychain only while the owner asked to see it.

export const pill = buttonVariants({ variant: "soft", size: "xs" });
const icon = buttonVariants({ variant: "ghost", size: "icon-xs" });
// A secret's name and value are mono, like the code that reads them.
export const field = cn(fieldVariants({ size: "sm" }), "font-mono placeholder:font-sans");
export const saveButton = buttonVariants({ variant: "soft", size: "sm" });

// Typed into a password field: what's on screen is dots until it's kept.
export function ValueForm({ projectId, name, onDone }: { projectId: string; name: string; onDone: () => void }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const kept = await useEnv.getState().set(projectId, name, value);
    setSaving(false);
    if (kept) onDone();
  };
  return (
    <form className="flex items-center gap-2 pb-2 pl-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input autoFocus type="password" autoComplete="off" spellCheck={false} className={`${field} flex-1`} value={value} placeholder={`Value of ${name}`} aria-label={`Value of ${name}`} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onDone()} />
      <button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={onDone}>Cancel</button>
      <button type="submit" disabled={saving} className={saveButton}>Save</button>
    </form>
  );
}

export function EnvRow({ projectId, name, hint, isPublic }: { projectId: string; name: string; hint: string; isPublic: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const reveal = async () => {
    if (shown !== null) return setShown(null);
    try {
      setShown(await envReveal(projectId, name));
    } catch (error) {
      useEnv.setState((s) => ({ errorOf: { ...s.errorOf, [projectId]: String(error) } }));
    }
  };
  return (
    <li className="group border-b border-border last:border-0">
      <div className="flex min-h-10 min-w-0 items-center gap-2.5 px-1 py-2">
        <span className="min-w-0 truncate font-mono text-[12.5px]">{name}</span>
        {isPublic && <span className="flex-none text-[11px] text-muted-foreground" title="Built into the website, so anyone visiting it can read it">public</span>}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">{hint ? `••••${hint}` : "••••"}</span>
        <span className="flex flex-none items-center opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" title={shown === null ? "Show the value" : "Hide it"} aria-label={shown === null ? `Show ${name}` : `Hide ${name}`} className={icon} onClick={() => void reveal()}>
            {shown === null ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button type="button" title="Change the value" aria-label={`Change ${name}`} className={icon} onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Remove (it can be put back)" aria-label={`Remove ${name}`} className={icon} onClick={() => void useEnv.getState().remove(projectId, name)}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {shown !== null && <p className="mb-2 ml-1 select-all break-all rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-[12px]">{shown || "(empty)"}</p>}
      {editing && <ValueForm projectId={projectId} name={name} onDone={() => setEditing(false)} />}
    </li>
  );
}

export function MissingRow({ projectId, name }: { projectId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="border-b border-border last:border-0">
      <div className="flex min-h-10 min-w-0 items-center gap-2.5 px-1 py-2">
        <span className="min-w-0 truncate font-mono text-[12.5px] text-muted-foreground">{name}</span>
        <span className="flex-1 text-[11.5px] text-attention">missing</span>
        {!editing && <button type="button" className={pill} onClick={() => setEditing(true)}>Set it</button>}
      </div>
      {editing && <ValueForm projectId={projectId} name={name} onDone={() => setEditing(false)} />}
    </li>
  );
}
