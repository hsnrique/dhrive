import { useState, type ReactNode } from "react";

import type { Connected, McpServer, ServerStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

// The lists on a CLI's screen. Long ones show their first rows until the owner asks for the rest.

const FIRST_ROWS = 8;

const DOT: Record<ServerStatus, string> = {
  connected: "bg-live",
  "needs-auth": "bg-attention",
  failed: "bg-failure",
  connecting: "bg-foreground/40 motion-safe:animate-pulse",
  configured: "bg-foreground/35",
  disabled: "bg-foreground/15",
};

const STATE: Record<ServerStatus, string> = { connected: "Connected", "needs-auth": "Needs sign-in", failed: "Failed", connecting: "Connecting", configured: "Set up", disabled: "Off" };

export function Section({ title, count, summary, children }: { title: string; count: number; summary?: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{count}</span>
        {summary && <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">{summary}</span>}
      </div>
      {children}
    </section>
  );
}

function Rows<T>({ items, all, row }: { items: T[]; all: boolean; row: (item: T, index: number) => ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const shown = all || expanded ? items : items.slice(0, FIRST_ROWS);
  return (
    <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-card">
      {shown.map(row)}
      {shown.length < items.length && (
        <li>
          <button type="button" className="w-full px-4 py-2 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground" onClick={() => setExpanded(true)}>
            Show all {items.length}
          </button>
        </li>
      )}
    </ul>
  );
}

export function ServerRows({ servers, all }: { servers: McpServer[]; all: boolean }) {
  return (
    <Rows
      items={servers}
      all={all}
      row={(s, i) => (
        <li key={`${s.source}:${s.name}:${i}`} className="flex items-center gap-3 px-4 py-2">
          <span className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT[s.status])} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px]">
              {s.name}
              {s.source && <span className="text-[11px] text-muted-foreground"> · {s.source}</span>}
            </p>
            {s.error && <p className="truncate text-[11px] text-failure" title={s.error}>{s.error}</p>}
          </div>
          <span className="flex-none text-[11px] text-muted-foreground">{s.status === "connected" && s.tools ? `${s.tools} tools` : STATE[s.status]}</span>
        </li>
      )}
    />
  );
}

export function ItemRows({ items, all }: { items: Connected[]; all: boolean }) {
  return (
    <Rows
      items={items}
      all={all}
      row={(item, i) => (
        <li key={`${item.source}:${item.name}:${i}`} className={cn("flex items-center gap-3 px-4 py-2", !item.on && "opacity-55")}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px]">{item.name}</p>
            {item.detail && <p className="truncate text-[11px] text-muted-foreground" title={item.detail}>{item.detail}</p>}
          </div>
          {!item.on && <span className="flex-none text-[11px] text-muted-foreground">Off</span>}
          {item.source && <span className="max-w-[40%] flex-none truncate rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{item.source}</span>}
        </li>
      )}
    />
  );
}
