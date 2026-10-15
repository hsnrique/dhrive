import { useCallback, useEffect, useState } from "react";
import { Plug, X } from "lucide-react";

import { connectorOpen, type Connector, type Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConnectedOf, useConnectors } from "@/store/connectors";
import { Dialog } from "@/components/ui/layer";
import { buttonVariants } from "@/components/ui/button";
import { TerminalView } from "../terminals/TerminalView";
import { SiteLink, ToolMark } from "./ToolMark";
import { ToolsMenu } from "./ToolsMenu";

// The toolbar's tools: what the company's agents can work with beyond the code (a database,
// payments, email, analytics), listed in ToolsMenu. Connecting one runs its setup in a terminal right
// here (connectors.rs): its CLI is installed if missing, the owner signs in through the browser, its
// skills land in the project; from then on every step's prompt names it.

const pill = cn(buttonVariants({ variant: "outline", size: "sm" }), "px-2.5 @[60rem]:px-3");
const label = "hidden @[60rem]:inline";
const primary = cn(buttonVariants({ variant: "primary", size: "sm" }), "px-3.5");
const quiet = cn(buttonVariants({ variant: "ghost", size: "sm" }), "px-2.5");
const iconButton = buttonVariants({ variant: "ghost", size: "icon-sm" });

// A connector's setup in its own terminal: the owner answers whatever a sign-in asks right there.
// Portaled to the body: the toolbar is a size container, which would hold a fixed box inside it.
function Run({ project, connector, onClose }: { project: Project; connector: Connector; onClose: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [ended, setEnded] = useState<"connected" | "stopped" | null>(null);
  const id = `connect-${connector.id}-${attempt}`;
  const start = useCallback((cols: number, rows: number) => connectorOpen(id, connector.id, project.id, cols, rows), [id, connector.id, project.id]);
  const onEvent = (event: { kind: string; code?: number }) => {
    if (event.kind !== "exit") return;
    const ok = event.code === 0;
    setEnded(ok ? "connected" : "stopped");
    if (ok) void useConnectors.getState().connected(project.id, connector.id);
  };
  return (
    <Dialog label={`Connecting ${connector.name}`} onClose={onClose} className="flex h-[min(560px,calc(100vh-48px))] max-w-[760px] flex-col overflow-hidden bg-background">
      <div className="flex h-12 flex-none items-center gap-2.5 border-b border-border pl-3 pr-2">
        <ToolMark id={connector.id} size={26} />
        <span className="text-[13px] font-medium">Connecting {connector.name}</span>
        <SiteLink site={connector.site} />
        <span className="ml-auto" />
        <button type="button" title="Close" aria-label="Close" className={iconButton} onClick={onClose}><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalView key={id} label={`${connector.name} setup`} id={id} start={start} project={project.id} copy={null} model="" task={null} onStarted={() => undefined} onEvent={onEvent} onTitle={() => undefined} onBranch={() => undefined} />
      </div>
      {ended && (
        <div className="flex h-12 flex-none items-center gap-3 border-t border-border px-4">
          <span className={cn("text-[12.5px]", ended === "stopped" && "text-failure")}>{ended === "connected" ? `${connector.name} is connected. The agents can use it now.` : "It stopped before finishing."}</span>
          <span className="ml-auto" />
          {ended === "stopped" && <button type="button" className={quiet} onClick={() => { setEnded(null); setAttempt((n) => n + 1); }}>Try again</button>}
          <button type="button" className={primary} onClick={onClose}>Done</button>
        </div>
      )}
    </Dialog>
  );
}

export function ConnectorsButton({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState<Connector | null>(null);
  const count = Object.keys(useConnectedOf(project.id) ?? {}).length;
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => void useConnectors.getState().load(project.id), [project.id]);
  return (
    <div className="relative flex items-center">
      <button type="button" aria-expanded={open} className={pill} aria-label="Tools for the agents" title="Connect tools the agents can use" onClick={() => setOpen((o) => !o)}>
        <Plug className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className={label}>Tools</span>
        {count > 0 && <span className="text-muted-foreground">{count}</span>}
      </button>
      {open && <ToolsMenu project={project} onClose={close} onRun={(c) => { setOpen(false); setRunning(c); }} />}
      {running && <Run project={project} connector={running} onClose={() => setRunning(null)} />}
    </div>
  );
}
