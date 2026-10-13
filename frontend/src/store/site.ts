import { create } from "zustand";

import { runSite, siteState, stopSite, type SiteState } from "@/lib/api";

// Each company's website as Play and Stop see it. While it runs (or is starting) its state is asked
// again every second, so the address shows the moment the server prints it and a crash shows at once.

const IDLE: SiteState = { app: false, running: false, port: null, log: [] };
const EVERY_MS = 1000;

export interface Site extends SiteState {
  // Between a click and the backend's answer.
  busy: boolean;
  error: string | null;
}

interface SiteStore {
  byProject: Record<string, Site>;
  refresh: (projectId: string) => Promise<void>;
  play: (projectId: string) => Promise<void>;
  stop: (projectId: string) => Promise<void>;
}

export const useSite = create<SiteStore>((set, get) => {
  const site = (projectId: string): Site => get().byProject[projectId] ?? { ...IDLE, busy: false, error: null };
  const patch = (projectId: string, change: Partial<Site>) => set((s) => ({ byProject: { ...s.byProject, [projectId]: { ...site(projectId), ...change } } }));
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const watch = (projectId: string) => {
    clearTimeout(timers.get(projectId));
    if (site(projectId).running) timers.set(projectId, setTimeout(() => void get().refresh(projectId), EVERY_MS));
  };

  return {
    byProject: {},
    refresh: async (projectId) => {
      try {
        patch(projectId, await siteState(projectId));
      } catch (error) {
        patch(projectId, { error: String(error) });
      }
      watch(projectId);
    },
    play: async (projectId) => {
      patch(projectId, { busy: true, error: null });
      try {
        await runSite(projectId);
      } catch (error) {
        patch(projectId, { error: String(error) });
      }
      patch(projectId, { busy: false });
      await get().refresh(projectId);
    },
    stop: async (projectId) => {
      patch(projectId, { busy: true });
      await stopSite(projectId).catch((error) => patch(projectId, { error: String(error) }));
      patch(projectId, { busy: false });
      await get().refresh(projectId);
    },
  };
});

export const useSiteOf = (projectId: string) => useSite((s) => s.byProject[projectId]) ?? { ...IDLE, busy: false, error: null };
