import { useState } from "react";
import { Plus } from "lucide-react";

import { suggestTool } from "@/lib/api";

// The Tools menu's last line: a tool the owner wishes were there goes straight to the dhrive team,
// in a few words and what it's for. It folds back once sent.

const field = "h-8 rounded-lg border border-border bg-black/30 px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-white/30";
const send = "h-8 flex-none rounded-md bg-foreground px-3.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40";

type State = "closed" | "open" | "sending" | "sent";

export function SuggestTool() {
  const [state, setState] = useState<State>("closed");
  const [tool, setTool] = useState("");
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!tool.trim() || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      await suggestTool(tool, why);
      setState("sent");
      setTool("");
      setWhy("");
      setTimeout(() => setState((s) => (s === "sent" ? "closed" : s)), 2600);
    } catch (e) {
      setError(String(e));
      setState("open");
    }
  };
  if (state === "closed" || state === "sent") {
    return (
      <button type="button" className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={() => setState("open")}>
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md border border-dashed border-white/15"><Plus className="h-3.5 w-3.5" /></span>
        {state === "sent" ? "Thanks. The dhrive team reads every one." : "Suggest a tool"}
      </button>
    );
  }
  return (
    <form className="grid gap-2 px-2 py-1.5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input autoFocus className={field} value={tool} maxLength={80} placeholder="Which tool?" aria-label="Which tool" onChange={(e) => setTool(e.target.value)} />
      <input className={field} value={why} maxLength={500} placeholder="What would the agents do with it? (optional)" aria-label="What it's for" onChange={(e) => setWhy(e.target.value)} />
      {error && <p className="text-[11.5px] text-failure" role="alert">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="h-8 rounded-md px-3 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setState("closed")}>Cancel</button>
        <button type="submit" className={send} disabled={!tool.trim() || state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );
}
