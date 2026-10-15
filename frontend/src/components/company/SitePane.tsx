import { useEffect } from "react";
import { Play, Square } from "lucide-react";

import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDay } from "@/store/day";
import { useSheet } from "@/store/sheet";
import { useSite, useSiteOf } from "@/store/site";
import { Chat } from "./Chat";
import { SiteActions } from "./SiteActions";

// Beside the company's work, its chat; and in the toolbar, its website run on this Mac like an app in
// Xcode: Play starts it and opens it in the website's sheet (SitePreview), Stop ends it. Nothing
// starts on its own.

// The toolbar's control, on every company page: Play or Stop, where the site answers here, and
// where it lives on the web.
export function RunControl({ project }: { project: Project }) {
  const site = useSiteOf(project.id);
  const { play, stop, refresh } = useSite.getState();
  // Asked again as tasks finish: the task that creates the app is what gives the site its Play.
  const done = useDay((s) => s.byProject[project.id]?.tasks.filter((t) => t.status === "done").length ?? 0);
  useEffect(() => void refresh(project.id), [project.id, refresh, done]);
  if (!site.app) return null;
  const starting = site.running && site.port === null;
  return (
    <div className="flex items-center gap-2">
      <SiteActions projectId={project.id} />
      <span className="mx-0.5 h-4 w-px bg-border" />
      {site.running && (
        <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 rounded-full", starting ? "node-live bg-foreground" : "bg-live")} />
          {starting ? "Starting…" : (
            <button type="button" className="hidden font-mono text-[11.5px] text-foreground/85 transition-colors hover:text-foreground @[60rem]:inline" title="See it here" onClick={() => useSheet.getState().show(project.id, "local")}>
              localhost:{site.port}
            </button>
          )}
        </span>
      )}
      <button
        type="button"
        disabled={site.busy}
        title={site.running ? "Stop the website" : "Run the website"}
        aria-label={site.running ? "Stop the website" : "Run the website"}
        className={cn("flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40", site.running ? "bg-selected hover:bg-pressed" : "bg-foreground text-background hover:opacity-90")}
        onClick={() => {
          if (site.running) return void stop(project.id);
          useSheet.getState().show(project.id, "local");
          void play(project.id);
        }}
      >
        {site.running ? <Square className="h-2.5 w-2.5 fill-current" /> : <Play className="ml-px h-3 w-3 fill-current" />}
      </button>
    </div>
  );
}

export function SidePane({ project, className }: { project: Project; className?: string }) {
  return (
    <aside className={cn("flex-col border-l border-border bg-background", className)}>
      <div className="flex h-11 flex-none items-center border-b border-border px-4">
        <h2 className="text-[12.5px] font-medium">Chat</h2>
      </div>
      <div className="min-h-0 flex-1">
        <Chat project={project} />
      </div>
    </aside>
  );
}
