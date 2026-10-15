import { useState, type PointerEvent } from "react";
import { Check, Copy, ExternalLink, RotateCw, X } from "lucide-react";

import { openFile } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { BROWSER, tabKey, usePanel, type Tab } from "@/store/panel";
import { BrowserView } from "./BrowserView";
import { FileBody, isMarkdown } from "./FileBody";

// The side panel next to a conversation: tabs of the project's files and folders, opened from a
// mention, a changed file or the project's file list, and its browser tab. Its left edge drags to
// resize.

const nameOf = (tab: Tab, projectName: string) => (tab.path === BROWSER ? "Browser" : tab.path.replace(/\/$/, "").split("/").pop() || projectName);

function Tool({ title, onClick, children, on }: { title: string; onClick: () => void; children: React.ReactNode; on?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} className={cn("flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground", on && "bg-selected text-foreground")} onClick={onClick}>
      {children}
    </button>
  );
}

function Toolbar({ tab, source, setSource, reload }: { tab: Tab; source: boolean; setSource: (v: boolean) => void; reload: () => void }) {
  const report = useApp((s) => s.reportError);
  const [copied, setCopied] = useState(false);
  const folder = tab.path === "" || tab.path.endsWith("/");
  const copy = () =>
    void navigator.clipboard.writeText(tab.path || ".").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1">
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={tab.path}>
        {tab.path || "./"}
      </span>
      {isMarkdown(tab.path) && (
        <>
          <Tool title="Show it as it reads" on={!source} onClick={() => setSource(false)}>Preview</Tool>
          <Tool title="Show the Markdown source" on={source} onClick={() => setSource(true)}>Source</Tool>
        </>
      )}
      <Tool title="Copy the path" onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Tool>
      <Tool title="Read it again from disk" onClick={reload}><RotateCw className="h-3.5 w-3.5" /></Tool>
      <Tool title={folder ? "Show in Finder" : "Open in its own app"} onClick={() => void openFile(tab.folder, tab.path).catch(report)}>
        <ExternalLink className="h-3.5 w-3.5" />
      </Tool>
    </div>
  );
}

function ResizeEdge() {
  const setWidth = usePanel((s) => s.setWidth);
  const start = (e: PointerEvent<HTMLDivElement>) => {
    const from = e.clientX;
    const width = usePanel.getState().width;
    const move = (m: globalThis.PointerEvent) => setWidth(width + from - m.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  return <div role="separator" aria-orientation="vertical" title="Drag to resize" className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize" onPointerDown={start} />;
}

export function FilePanel({ folder, projectName }: { folder: string; projectName: string }) {
  const all = usePanel((s) => s.tabs);
  const active = usePanel((s) => s.active);
  const width = usePanel((s) => s.width);
  const { open, close } = usePanel.getState();
  const tabs = all.filter((t) => t.folder === folder);
  const current = tabs.find((t) => tabKey(t) === active) ?? tabs[tabs.length - 1];
  const [source, setSource] = useState(false);
  const [version, setVersion] = useState(0);
  if (!current) return null;

  return (
    // Never more than a bit over half the room, so the conversation stays readable in a small window.
    <aside className="relative flex h-full max-w-[55%] flex-none flex-col border-l border-border bg-card" style={{ width }}>
      <ResizeEdge />
      <div data-tauri-drag-region className="flex h-[52px] flex-none items-end gap-0.5 overflow-x-auto border-b border-border px-2">
        {tabs.map((tab) => {
          const on = tab === current;
          return (
            <div key={tabKey(tab)} className={cn("group flex max-w-44 flex-none items-center gap-1 rounded-t-lg border border-b-0 px-2 py-1.5 text-[12px]", on ? "border-border bg-background text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              <button type="button" title={tab.path || projectName} className="min-w-0 truncate" onClick={() => open(tab.folder, tab.path)}>
                {nameOf(tab, projectName)}
              </button>
              <button type="button" aria-label={`Close ${nameOf(tab, projectName)}`} className={cn("-my-1 -mr-1.5 flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground", !on && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100")} onClick={() => close(tab)}>
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      {current.path === BROWSER ? (
        <BrowserView folder={folder} />
      ) : (
        <>
          <Toolbar tab={current} source={source} setSource={setSource} reload={() => setVersion((v) => v + 1)} />
          <div className="min-h-0 flex-1 overflow-auto bg-background">
            <FileBody key={tabKey(current)} tab={current} source={source} version={version} />
          </div>
        </>
      )}
    </aside>
  );
}
