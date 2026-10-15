import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight } from "lucide-react";

import type { Project } from "@/lib/api";
import { cn } from "@/lib/utils";
import { hostOf } from "@/lib/domains";
import { useAddress } from "@/store/favorite";
import { useFold } from "@/store/fold";
import { usePublish, usePublishedOf } from "@/store/publish";
import { useSiteOf } from "@/store/site";
import { useVersions, useVersionsOf, versionDate } from "@/store/versions";
import { OwnDomains } from "./OwnDomains";
import { SectionHead } from "./SectionHead";
import { SitePreview } from "./SitePreview";

// The company's website on the web: where it lives, the owner's own domain for it, and the version
// that's live, with every other one the host keeps a click away and one more from being live again,
// then a small preview of it. Before its first publish, the one thing to do about it.

// Shown folded: just the live one.
const SHOWN = 1;

function NotYet({ projectId }: { projectId: string }) {
  const site = useSiteOf(projectId);
  return (
    <section className="grid gap-3">
      <SectionHead title="Website" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <span className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">{site.app ? "Not on the web yet." : "It arrives with the first delivery."}</span>
        {site.app && (
          <button type="button" className="h-7 flex-none rounded-md bg-selected px-3 text-[12px] font-medium transition-colors hover:bg-pressed" onClick={() => void usePublish.getState().publish(projectId)}>
            Publish
          </button>
        )}
      </div>
    </section>
  );
}

export function Website({ project }: { project: Project }) {
  const { url, at } = usePublishedOf(project.id);
  const address = useAddress(project.id);
  const { releases, moving, error } = useVersionsOf(project.id);
  const [all, setAll] = useFold(`versions:${project.id}`);
  // Asked again after every publish, so the newest version shows up live.
  useEffect(() => {
    if (url) void useVersions.getState().load(project.id);
  }, [project.id, url, at]);
  if (!url) return <NotYet projectId={project.id} />;
  const sorted = [...(releases ?? [])].sort((a, b) => Number(b.live) - Number(a.live));
  const shown = all ? releases ?? [] : sorted.slice(0, SHOWN);
  return (
    <section className="grid gap-3">
      <SectionHead title="Website">
        <button type="button" className="flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-hover" onClick={() => void openUrl(address ?? url).catch(() => undefined)}>
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-live" />
          <span className="truncate">{hostOf(address ?? url)}</span>
          <ArrowUpRight className="h-3 w-3 flex-none text-muted-foreground" />
        </button>
      </SectionHead>
      <OwnDomains projectId={project.id} />
      <div className="grid gap-2">
        <div className="flex h-7 items-center px-1">
          <h3 className="text-[12px] font-medium text-muted-foreground">Versions</h3>
          <span className="ml-auto" />
          {(releases?.length ?? 0) > SHOWN && (
            <button type="button" className="text-[12px] text-muted-foreground transition-colors hover:text-foreground" onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${releases!.length}`}
            </button>
          )}
        </div>
        {releases === null && !error && <p className="px-1 text-[12.5px] text-muted-foreground">Asking the site host…</p>}
        {error && <p className="px-1 text-[12.5px] text-failure">{error}</p>}
        <ul className="grid gap-1.5">
          {shown.map((release) => (
            <li key={release.at} className={cn("flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-3 py-1.5", release.live && "border-white/20")}>
              <span className="text-[12.5px] tabular-nums">{versionDate(release.at)}</span>
              <span className="ml-auto" />
              {release.live ? (
                <span className="flex items-center gap-1.5 text-[12px] text-foreground/85">
                  <span className="h-1.5 w-1.5 rounded-full bg-live" />
                  Live
                </span>
              ) : (
                <button type="button" disabled={moving !== null} className="h-6 rounded-md bg-selected px-2.5 text-[11.5px] font-medium transition-colors hover:bg-pressed disabled:opacity-40" onClick={() => void useVersions.getState().makeLive(project.id, release.at)}>
                  {moving === release.at ? "Putting it back…" : "Make live"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <SitePreview project={project} />
    </section>
  );
}
