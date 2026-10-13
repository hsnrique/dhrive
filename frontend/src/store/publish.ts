import { create } from "zustand";

import { buildSite, publishSite, sitePublished } from "@/lib/api";
import { buildFailure, headline } from "@/lib/build";
import { entry } from "@/lib/log";
import { readSaved, save } from "@/lib/storage";
import { useLog } from "./log";

// Each company's website on the web: where it lives once published, and the build or publish in
// flight. The site host is the truth about where it lives: each opening of a company asks it, and
// what this webview remembers only shows it until the answer comes (another install, or a cleared
// webview, has no memory of a publish it didn't make). Both build the static export on this Mac, so they take a minute; the
// owner can build alone first, to catch what would break the publish. A failed build goes in the
// company's timeline with its output, where the agent can be asked to fix it.

const KEY = "company.published";

export interface Published {
  url: string | null;
  at: number | null;
  busy: boolean;
  building: boolean;
  // When the last build alone passed, this session.
  builtAt: number | null;
  error: string | null;
}

const NONE: Published = { url: null, at: null, busy: false, building: false, builtAt: null, error: null };

// The error to show in a line; a failed build's whole output goes to the timeline instead.
const shown = (error: string) => (buildFailure(error) !== null ? "The website didn't build" : error);

function savedSites(value: unknown): Record<string, Published> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, Partial<Published>>)
      .filter(([, p]) => typeof p?.url === "string" && p.url.startsWith("https://"))
      .map(([id, p]) => [id, { ...NONE, url: p.url!, at: typeof p.at === "number" ? p.at : null }]),
  );
}

interface PublishState {
  byProject: Record<string, Published>;
  publish: (projectId: string) => Promise<void>;
  sync: (projectId: string) => Promise<void>;
  build: (projectId: string) => Promise<boolean>;
}

export const usePublish = create<PublishState>((set, get) => {
  const of = (projectId: string) => get().byProject[projectId] ?? NONE;
  const patch = (projectId: string, change: Partial<Published>) => {
    const byProject = { ...get().byProject, [projectId]: { ...of(projectId), ...change } };
    save(KEY, Object.fromEntries(Object.entries(byProject).map(([id, { url, at }]) => [id, { url, at }])));
    set({ byProject });
  };
  const failed = (projectId: string, error: string) => {
    const output = buildFailure(error);
    if (output !== null) useLog.getState().add(projectId, entry("build", headline(output), { detail: output }));
    patch(projectId, { busy: false, building: false, error: shown(error) });
  };
  return {
    byProject: savedSites(readSaved(KEY)),
    publish: async (projectId) => {
      if (of(projectId).busy || of(projectId).building) return;
      patch(projectId, { busy: true, error: null });
      try {
        const { url } = await publishSite(projectId);
        patch(projectId, { busy: false, url, at: Date.now() });
        useLog.getState().add(projectId, entry("published", url.replace(/^https:\/\//, ""), { url }));
      } catch (error) {
        failed(projectId, String(error));
      }
    },
    sync: async (projectId) => {
      try {
        const live = await sitePublished(projectId);
        const now = of(projectId);
        if (now.busy || ((live?.url ?? null) === now.url && (live?.at ?? null) === now.at)) return;
        patch(projectId, live ? { url: live.url, at: live.at } : { url: null, at: null });
      } catch {
        // Offline or signed out: the remembered address stands until the host can be asked.
      }
    },
    build: async (projectId) => {
      if (of(projectId).busy || of(projectId).building) return false;
      patch(projectId, { building: true, error: null });
      try {
        await buildSite(projectId);
        patch(projectId, { building: false, builtAt: Date.now() });
        return true;
      } catch (error) {
        failed(projectId, String(error));
        return false;
      }
    },
  };
});

export const usePublishedOf = (projectId: string) => usePublish((s) => s.byProject[projectId]) ?? NONE;
