import { useEffect, useState } from "react";
import { RotateCw, Search } from "lucide-react";

import type { Connected, Connections, Engine, McpServer } from "@/lib/api";
import { itemSummary, serverSummary, sortServers } from "@/lib/connections";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { connectionsKey, useConnections } from "@/store/connections";
import { useConversations } from "@/store/conversations";
import { ItemRows, Section, ServerRows } from "./ConnectionList";
import { EngineMark } from "./EngineMark";
import { PlanUsageCard } from "./PlanUsage";

// A CLI's own screen: its plan, and everything it brings to a run in a project (MCP servers and
// whether they're connected, skills, plugins, subagents, hooks), as the CLI itself reports it.

const SIGN_IN: Partial<Record<Engine, string>> = {
  "claude-code": "Sign in with /mcp in Claude Code.",
  codex: "Sign in with: codex mcp login <name>",
};

const matches = (query: string, ...texts: (string | null)[]) => texts.some((t) => t?.toLowerCase().includes(query));

function filtered(value: Connections, query: string) {
  const q = query.trim().toLowerCase();
  const items = (list: Connected[]) => (q ? list.filter((i) => matches(q, i.name, i.detail, i.source)) : list);
  const servers = (list: McpServer[]) => (q ? list.filter((s) => matches(q, s.name, s.source, s.error)) : list);
  return { servers: sortServers(servers(value.servers)), skills: items(value.skills), plugins: items(value.plugins), agents: items(value.agents), hooks: items(value.hooks) };
}

function ProjectPicker({ folder, onChange }: { folder: string; onChange: (folder: string) => void }) {
  const projects = useApp((s) => s.projects);
  return (
    <select aria-label="Seen from" value={folder} className="min-w-0 truncate rounded-md border border-border bg-transparent px-1.5 py-0.5 font-sans text-[11.5px] text-foreground/85 outline-none focus:border-ring" onChange={(e) => onChange(e.target.value)}>
      {projects.map((p) => (
        <option key={p.id} value={p.folder}>{p.name}</option>
      ))}
      <option value="">No project</option>
    </select>
  );
}

function Everything({ engine, value, query }: { engine: Engine; value: Connections; query: string }) {
  const all = query.trim() !== "";
  const shown = filtered(value, query);
  const needsSignIn = shown.servers.some((s) => s.status === "needs-auth");
  const lists: [string, Connected[]][] = [["Skills", shown.skills], ["Plugins", shown.plugins], ["Subagents", shown.agents], ["Hooks", shown.hooks]];
  return (
    <>
      <Section title="MCP servers" count={shown.servers.length} summary={serverSummary(shown.servers)}>
        {needsSignIn && <p className="mt-1 text-[11.5px] text-muted-foreground">{SIGN_IN[engine]}</p>}
        {shown.servers.length > 0 ? <ServerRows servers={shown.servers} all={all} /> : <p className="mt-2 text-[12px] text-muted-foreground">None.</p>}
      </Section>
      {lists
        .filter(([, items]) => items.length > 0)
        .map(([title, items]) => (
          <Section key={title} title={title} count={items.length} summary={itemSummary(items)}>
            <ItemRows items={items} all={all} />
          </Section>
        ))}
    </>
  );
}

export function CliPage({ engine }: { engine: Engine }) {
  const cli = useApp((s) => s.clis.find((c) => c.engine === engine));
  const [folder, setFolder] = useState(() => {
    const { projects } = useApp.getState();
    const openId = useConversations.getState().open?.projectId;
    return (projects.find((p) => p.id === openId) ?? projects[0])?.folder ?? "";
  });
  const [query, setQuery] = useState("");
  const seen = useConnections((s) => s.seen[connectionsKey(engine, folder)]);
  const refresh = () => void useConnections.getState().refresh(engine, folder);
  useEffect(refresh, [engine, folder]);
  const label = cli?.label ?? engine;

  return (
    <div data-tauri-drag-region className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[680px] px-8 pb-16 pt-[68px]">
        <EngineMark engine={engine} className="h-7 w-7" />
        <h1 className="mt-5 font-serif text-[40px] leading-[1.05] tracking-[-0.01em]">{label}</h1>
        <div className="mt-2 flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
          {cli?.version && <span>{cli.version}</span>}
          <span aria-hidden>·</span>
          <span className="font-sans">Seen from</span>
          <ProjectPicker folder={folder} onChange={setFolder} />
        </div>
        <div className="mt-6 rounded-2xl border border-border bg-card p-4">
          <PlanUsageCard engine={engine} label={label} />
        </div>
        <div className="mt-8 flex items-center gap-2">
          <label className="flex h-8 flex-1 items-center gap-2 rounded-lg border border-border bg-black/30 px-2.5 focus-within:border-ring">
            <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" />
            <input aria-label="Filter" placeholder="Filter servers, skills, plugins…" spellCheck={false} value={query} className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground" onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button type="button" title="Ask again" className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={refresh}>
            <RotateCw className={cn("h-3.5 w-3.5", seen?.loading && "motion-safe:animate-spin")} />
            {seen?.loading ? "Asking" : "Ask again"}
          </button>
        </div>
        {seen?.error && <p className="mt-3 text-[12px] text-failure">Couldn't ask {label}: {seen.error}</p>}
        {seen?.value ? <Everything engine={engine} value={seen.value} query={query} /> : !seen?.error && <p className="mt-8 text-[12.5px] text-muted-foreground">Asking {label} what it has connected. MCP servers take a few seconds to answer.</p>}
      </div>
    </div>
  );
}
