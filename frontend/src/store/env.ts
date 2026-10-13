import { create } from "zustand";

import { envRemove, envRestore, envSet, envView, type EnvView } from "@/lib/api";

// Each company's environment as the screen shows it (names, never values), and the changes made to
// it. Every change returns the whole view again, so the screen never guesses what the vault holds.

interface EnvState {
  byProject: Record<string, EnvView>;
  errorOf: Record<string, string | null>;
  load: (projectId: string) => Promise<void>;
  // True once it's kept, so a form knows it can close.
  set: (projectId: string, name: string, value: string) => Promise<boolean>;
  remove: (projectId: string, name: string) => Promise<void>;
  restore: (projectId: string, name: string) => Promise<void>;
}

export const useEnv = create<EnvState>((set, get) => {
  const apply = async (projectId: string, change: () => Promise<EnvView>) => {
    try {
      const view = await change();
      set({ byProject: { ...get().byProject, [projectId]: view }, errorOf: { ...get().errorOf, [projectId]: null } });
      return true;
    } catch (error) {
      set({ errorOf: { ...get().errorOf, [projectId]: String(error) } });
      return false;
    }
  };
  return {
    byProject: {},
    errorOf: {},
    load: async (projectId) => void (await apply(projectId, () => envView(projectId))),
    set: (projectId, name, value) => apply(projectId, () => envSet(projectId, name.trim(), value)),
    remove: async (projectId, name) => void (await apply(projectId, () => envRemove(projectId, name))),
    restore: async (projectId, name) => void (await apply(projectId, () => envRestore(projectId, name))),
  };
});
