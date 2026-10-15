import { useEffect, useRef, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { Connector, Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConnectedOf, useConnectors } from "@/store/connectors";
import { useGitHub, useGitHubOf } from "@/store/github";
import { buttonVariants } from "@/components/ui/button";
import { SuggestTool } from "./SuggestTool";
import { SiteLink, ToolMark } from "./ToolMark";

// The Tools menu (opaque, unlike the other popovers: it's tall, and the sections behind would read
// through its rows): every tool by its kind, each row its mark, its name with a link to its own site,
// what it's for, and Connect (or Connected, which runs the setup again); at the end, a way to
// suggest one that isn't there. GitHub heads the code and
// data, connected through gh the way the GitHub button does.

const connect = buttonVariants({ variant: "outline", size: "sm" });
const again = cn(buttonVariants({ variant: "ghost", size: "sm" }), "px-2");

const GITHUB = { id: "github", name: "GitHub", what: "Code, commits and backups", group: "Code and data", site: "https://github.com" };

interface Tool {
  id: string;
  name: string;
  what: string;
  site: string;
}

function Row({ tool, connected, action, onConnect }: { tool: Tool; connected: boolean; action?: string; onConnect: () => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover">
      <ToolMark id={tool.id} />
      <div className="grid min-w-0 flex-1 gap-px">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[13px] font-medium">{tool.name}</span>
          <SiteLink site={tool.site} />
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">{tool.what}</span>
      </div>
      {connected ? (
        <button type="button" className={again} title="Run its setup again" onClick={onConnect}>
          <span className="h-1.5 w-1.5 rounded-full bg-live" />
          Connected
        </button>
      ) : (
        <button type="button" className={connect} onClick={onConnect}>{action ?? "Connect"}</button>
      )}
    </li>
  );
}

function Group({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li className="border-t border-border pt-2 first:border-t-0 first:pt-0">
      <p className="px-2 pb-0.5 pt-1 text-[11.5px] text-muted-foreground">{name}</p>
      <ul className="grid">{children}</ul>
    </li>
  );
}

// The catalog's order keeps each kind together; groups come out in the order they first appear.
function grouped(catalog: Connector[]): [string, Connector[]][] {
  const groups = new Map<string, Connector[]>([[GITHUB.group, []]]);
  catalog.forEach((c) => groups.set(c.group, [...(groups.get(c.group) ?? []), c]));
  return [...groups];
}

export function ToolsMenu({ project, onRun, onClose }: { project: Project; onRun: (connector: Connector) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const catalog = useConnectors((s) => s.catalog);
  const connected = useConnectedOf(project.id) ?? {};
  const github = useGitHubOf(project.id).state;
  const count = Object.keys(connected).length + (github?.account ? 1 : 0);
  useEffect(() => {
    // The menu and its button share a parent; a press on the button is its own toggle.
    const away = (e: PointerEvent) => !box.current?.parentElement?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const connectGitHub = () => {
    if (!github?.gh) return void openUrl("https://cli.github.com").catch(() => undefined);
    onClose();
    void useGitHub.getState().signIn(project.id);
  };
  return (
    <div ref={box} className="absolute right-0 top-9 z-30 w-[min(400px,calc(100vw-32px))] rounded-2xl border border-border bg-popover p-2 shadow-popover">
      <div className="flex items-baseline justify-between gap-3 px-2 pb-2 pt-1.5">
        <span className="text-[13px] font-medium">Tools</span>
        <span className="text-[11.5px] text-muted-foreground">{count > 0 ? `${count} connected` : "The agents use them through their own CLIs"}</span>
      </div>
      <ul className="grid max-h-[min(600px,calc(100vh-110px))] gap-1 overflow-y-auto">
        {grouped(catalog).map(([group, tools]) => (
          <Group key={group} name={group}>
            {group === GITHUB.group && <Row tool={GITHUB} connected={Boolean(github?.account)} action={github?.gh === false ? "Get gh" : undefined} onConnect={connectGitHub} />}
            {tools.map((c) => <Row key={c.id} tool={c} connected={c.id in connected} onConnect={() => onRun(c)} />)}
          </Group>
        ))}
      </ul>
      <div className="mt-1 border-t border-border pt-1.5">
        <SuggestTool />
      </div>
    </div>
  );
}
