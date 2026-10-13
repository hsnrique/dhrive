import { create } from "zustand";

import { makeReleaseLive, siteReleases } from "@/lib/api";
import { entry } from "@/lib/log";
import { useLog } from "./log";
import { usePublish } from "./publish";

// Each company's website versions as the site host keeps them, asked when the company's page shows
// them and again after every publish. Putting one back is the owner's call, and goes in the timeline.

export interface Release {
  at: number;
  live: boolean;
}

export interface Versions {
  releases: Release[] | null;
  // The version being put back.
  moving: number | null;
  error: string | null;
}

export const UNKNOWN: Versions = { releases: null, moving: null, error: null };

export const versionDate = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

interface VersionsState {
  byProject: Record<string, Versions>;
  load: (projectId: string) => Promise<void>;
  makeLive: (projectId: string, at: number) => Promise<void>;
}

export const useVersions = create<VersionsState>((set, get) => {
  const of = (projectId: string) => get().byProject[projectId] ?? UNKNOWN;
  const patch = (projectId: string, change: Partial<Versions>) => set({ byProject: { ...get().byProject, [projectId]: { ...of(projectId), ...change } } });
  return {
    byProject: {},
    load: async (projectId) => {
      try {
        patch(projectId, { releases: await siteReleases(projectId), error: null });
      } catch (error) {
        patch(projectId, { error: String(error) });
      }
    },
    makeLive: async (projectId, at) => {
      if (of(projectId).moving !== null) return;
      patch(projectId, { moving: at, error: null });
      try {
        await makeReleaseLive(projectId, at);
        const url = usePublish.getState().byProject[projectId]?.url ?? undefined;
        useLog.getState().add(projectId, entry("published", `the version from ${versionDate(at)} is live again`, url ? { url } : {}));
        patch(projectId, { moving: null, releases: (of(projectId).releases ?? []).map((r) => ({ ...r, live: r.at === at })) });
      } catch (error) {
        patch(projectId, { moving: null, error: String(error) });
      }
    },
  };
});

export const useVersionsOf = (projectId: string) => useVersions((s) => s.byProject[projectId] ?? UNKNOWN);
