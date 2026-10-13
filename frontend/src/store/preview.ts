import { create } from "zustand";

import { devServers } from "@/lib/api";
import { portUrl } from "@/lib/preview";

// Each project's browser tab: the page it shows, the dev servers found running from its folder, and
// a reload count the page is keyed on, bumped by hand or when a code step ends.

export interface Preview {
  url: string | null;
  ports: number[];
  version: number;
}

interface PreviewState {
  byFolder: Record<string, Preview>;
  detect: (folder: string) => Promise<void>;
  show: (folder: string, url: string) => void;
  reload: (folder: string) => void;
}

const EMPTY: Preview = { url: null, ports: [], version: 0 };
export const previewOf = (state: PreviewState, folder: string) => state.byFolder[folder] ?? EMPTY;

export const usePreview = create<PreviewState>((set, get) => {
  const patch = (folder: string, change: (p: Preview) => Partial<Preview>) =>
    set((state) => ({ byFolder: { ...state.byFolder, [folder]: { ...previewOf(state, folder), ...change(previewOf(state, folder)) } } }));

  return {
    byFolder: {},

    // The first server found becomes the page until the owner picks another.
    detect: async (folder) => {
      const ports = await devServers(folder).catch(() => []);
      patch(folder, (p) => ({ ports, url: p.url ?? (ports[0] ? portUrl(ports[0]) : null) }));
    },

    show: (folder, url) => patch(folder, (p) => ({ url, version: p.version + 1 })),

    reload: (folder) => {
      patch(folder, (p) => ({ version: p.version + 1 }));
      void get().detect(folder);
    },
  };
});
