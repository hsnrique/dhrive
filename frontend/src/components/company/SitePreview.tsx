import { useEffect, useRef, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Play, RotateCw, X } from "lucide-react";

import type { Project } from "@/lib/api";
import { useWidth } from "@/lib/deck";
import { hostOf } from "@/lib/domains";
import { useDayOf } from "@/store/day";
import { useAddress } from "@/store/favorite";
import { usePublishedOf } from "@/store/publish";
import { useSheet } from "@/store/sheet";
import { useSite, useSiteOf } from "@/store/site";
import { Page } from "../BrowserView";

// The company's website seen from inside dhrive: a small live preview under its versions, and the
// whole page in a sheet, the published site (from the preview) or the one running on this Mac like an
// app in Xcode (from Play). Either opens in the browser too. The preview and the sheet show the site
// at its own address on the host, the one dhrive's window may frame; the browser gets the favorite.

// The preview draws the page at a desktop width, scaled down to fit.
const PAGE = { width: 1280, height: 800 };
const open = (url: string) => void openUrl(url).catch(() => undefined);
const localAt = (port: number) => `http://localhost:${port}`;
const iconButton = "flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground";

export function SitePreview({ project }: { project: Project }) {
  const { url, at } = usePublishedOf(project.id);
  const address = useAddress(project.id);
  const frame = useRef<HTMLDivElement>(null);
  const scale = useWidth(frame) / PAGE.width;
  if (!url) return null;
  return (
    <div className="grid gap-2">
      <div className="flex h-7 items-center px-1">
        <h3 className="text-[12px] font-medium text-muted-foreground">Preview</h3>
        <span className="ml-auto" />
        <button type="button" className="flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground" onClick={() => open(address ?? url)}>
          Open in browser
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
      <div ref={frame} className="relative aspect-[16/10] overflow-hidden rounded-xl border border-border bg-white">
        {scale > 0 && (
          <iframe key={at ?? 0} src={url} title="" aria-hidden tabIndex={-1} loading="lazy" sandbox="allow-scripts allow-same-origin" className="pointer-events-none absolute left-0 top-0 origin-top-left border-0" style={{ width: PAGE.width, height: PAGE.height, transform: `scale(${scale})` }} />
        )}
        <button type="button" aria-label={`Open ${hostOf(address ?? url)} here`} className="absolute inset-0 rounded-xl ring-inset transition-shadow hover:ring-1 hover:ring-white/30 focus-visible:ring-2 focus-visible:ring-white/50" onClick={() => useSheet.getState().show(project.id, "live")} />
      </div>
    </div>
  );
}

function Waiting({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
      {children}
      <p className="text-[14px] text-foreground/90">{title}</p>
      {detail && <p className="max-w-[40ch] text-[12.5px] leading-relaxed text-muted-foreground">{detail}</p>}
    </div>
  );
}

// The site on this Mac when it isn't answering yet: still to be built, starting, stopped or crashed.
function NotAnswering({ project }: { project: Project }) {
  const site = useSiteOf(project.id);
  const building = useDayOf(project.id).tasks.some((t) => t.status === "running" || t.status === "planned");
  if (!site.app) return <Waiting title="The website arrives with the first delivery." detail={building ? "It's being built now, with the product." : "Suggest tasks, and the company builds it."} />;
  if (site.running) {
    return (
      <Waiting title="Starting the website" detail={site.log[site.log.length - 1]}>
        <span className="node-live h-2 w-2 rounded-full bg-foreground" />
      </Waiting>
    );
  }
  const crashed = site.log.length > 0;
  return (
    <Waiting title={crashed ? "The website stopped." : "Run the website"} detail={crashed ? undefined : "It runs on this Mac, where only you can see it."}>
      <button type="button" disabled={site.busy} aria-label="Run the website" className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-[0_10px_40px_rgba(255,255,255,0.12)] transition-transform hover:scale-105 disabled:opacity-40" onClick={() => void useSite.getState().play(project.id)}>
        <Play className="ml-0.5 h-5 w-5 fill-current" />
      </button>
      {crashed && <pre className="mt-2 max-h-40 w-full max-w-[52ch] overflow-auto whitespace-pre-wrap rounded-lg bg-black/45 p-3 text-left font-mono text-[11px] leading-relaxed text-muted-foreground">{site.log.join("\n")}</pre>}
      {site.error && <p className="text-[12px] text-[#ff8a8f]">{site.error}</p>}
    </Waiting>
  );
}

// What the sheet shows: the page's address here, the one the browser gets, and how to say which.
function useShown(project: Project, live: boolean) {
  const { url } = usePublishedOf(project.id);
  const address = useAddress(project.id);
  const site = useSiteOf(project.id);
  if (live) return { here: url, browser: address ?? url, label: "Live" };
  const local = site.running && site.port !== null ? localAt(site.port) : null;
  return { here: local, browser: local, label: "On this Mac" };
}

export function SiteSheet({ project }: { project: Project }) {
  const shown = useSheet((s) => (s.open?.projectId === project.id ? s.open.site : null));
  const close = useSheet((s) => s.close);
  const { here, browser, label } = useShown(project, shown === "live");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, close]);
  if (!shown) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div aria-hidden className="fade-in absolute inset-0 bg-black/60" onClick={close} />
      <div role="dialog" aria-modal="true" aria-label={`${project.name}'s website`} className="relative flex h-full max-h-[820px] w-full max-w-[1180px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-dialog">
        <div className="flex h-11 flex-none items-center gap-2 border-b border-border pl-4 pr-2">
          <span className="flex-none text-[12.5px] font-medium">{label}</span>
          {here && <span className="min-w-0 truncate font-mono text-[11.5px] text-muted-foreground">{hostOf(browser ?? here)}</span>}
          <span className="ml-auto" />
          {here && (
            <>
              <button type="button" title="Reload" aria-label="Reload" className={iconButton} onClick={() => setVersion((v) => v + 1)}>
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button type="button" title="Open in your browser" aria-label="Open in your browser" className={iconButton} onClick={() => open(browser ?? here)}>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button type="button" title="Close" aria-label="Close" className={iconButton} onClick={close}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-white">{here ? <Page url={here} version={version} /> : <div className="h-full bg-background"><NotAnswering project={project} /></div>}</div>
      </div>
    </div>
  );
}
