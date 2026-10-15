import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Check, CircleAlert, Globe, Hammer } from "lucide-react";

import { hostOf } from "@/lib/domains";
import { cn } from "@/lib/utils";
import { useAddress } from "@/store/favorite";
import { usePublish, usePublishedOf } from "@/store/publish";
import { buttonVariants } from "@/components/ui/button";

// The website's way to the web, in the toolbar: Build checks it on this Mac first, so whatever would
// break the publish shows up (and goes to the chat, ready to fix) before going live; Publish builds
// again and puts it up; the live address (the owner's favorite, store/favorite.ts) opens in the browser.

const pill = cn(buttonVariants({ variant: "outline", size: "sm" }), "px-2.5 @[60rem]:px-3");
const SHOW_BUILT_MS = 4_000;
// The toolbar is a container (CompanyView): below this its labels give way to their icons.
const label = "hidden @[60rem]:inline";

const Pulse = () => <span className="node-live mx-1 h-1.5 w-1.5 flex-none rounded-full bg-foreground" />;

// "Built" for a moment after a build passes, then back to Build.
function useJustBuilt(builtAt: number | null): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!builtAt) return;
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), SHOW_BUILT_MS);
    return () => clearTimeout(timer);
  }, [builtAt]);
  return fresh;
}

export function SiteActions({ projectId }: { projectId: string }) {
  const { url: published, busy, building, builtAt, error } = usePublishedOf(projectId);
  const url = useAddress(projectId);
  const built = useJustBuilt(builtAt);
  const { build, publish } = usePublish.getState();
  // The buttons stay where they are while one works: it says so in place, the toolbar never jumps.
  const working = busy ? "publish" : building ? "build" : null;
  return (
    <div className="flex items-center gap-1.5">
      {error && (
        <span className="flex min-w-0 items-center text-[11.5px] text-failure" title={error} role="alert">
          <CircleAlert className="h-3.5 w-3.5 flex-none @[52rem]:hidden" aria-label={error} />
          <span className="hidden max-w-[220px] truncate @[52rem]:inline">{error}</span>
        </span>
      )}
      {url && (
        <button type="button" className={pill} title={`Open ${hostOf(url)}`} aria-label={`Open ${hostOf(url)}`} onClick={() => void openUrl(url).catch(() => undefined)}>
          <span className="h-1.5 w-1.5 rounded-full bg-live" />
          <span className={`${label} max-w-[180px] truncate`}>{hostOf(url)}</span>
          <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
        </button>
      )}
      <button type="button" disabled={working === "publish"} aria-busy={working === "build"} className={pill} aria-label={working === "build" ? "Building" : built ? "Built" : "Build"} title="Build the website on this Mac, to catch errors before publishing" onClick={() => !working && void build(projectId)}>
        {working === "build" ? <Pulse /> : built ? <Check className="h-3.5 w-3.5 text-live" /> : <Hammer className="h-3.5 w-3.5" />}
        <span className={label}>{working === "build" ? "Building…" : built ? "Built" : "Build"}</span>
      </button>
      <button type="button" disabled={working === "build"} aria-busy={working === "publish"} className={pill} aria-label={working === "publish" ? "Publishing" : published ? "Publish again" : "Publish"} title={published ? "Publish what's on this Mac now" : "Put the website on the web"} onClick={() => !working && void publish(projectId)}>
        {working === "publish" ? <Pulse /> : <Globe className="h-3.5 w-3.5" />}
        <span className={label}>{working === "publish" ? "Publishing…" : published ? "Publish again" : "Publish"}</span>
      </button>
    </div>
  );
}
