import { create } from "zustand";

import { readSaved, save } from "@/lib/storage";

// The side panel's tabs: files and folders of a project opened from a mention, a changed file, or
// the project's own file list. Each project shows only its own tabs. Folders end in "/", and ""
// is the project folder itself.

export interface Tab {
  folder: string;
  path: string;
}

interface PanelState {
  tabs: Tab[];
  active: string | null;
  width: number;
  open: (folder: string, path: string) => void;
  // A folder tab walks into a subfolder in place, as Finder does.
  navigate: (tab: Tab, path: string) => void;
  close: (tab: Tab) => void;
  setWidth: (width: number) => void;
}

const MAX_TABS = 12;
export const MIN_WIDTH = 320;
export const MAX_WIDTH = 900;

export const tabKey = (tab: Tab) => `${tab.folder}::${tab.path}`;
// The project's browser tab rides along with its files. ponytail: a file literally named "::browser"
// at a project's root would open as the browser; a tab kind field is the upgrade if that ever matters.
export const BROWSER = "::browser";
const clampWidth = (width: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
const savedWidth = readSaved("panel.width");

export const usePanel = create<PanelState>((set, get) => ({
  tabs: [],
  active: null,
  width: typeof savedWidth === "number" ? clampWidth(savedWidth) : 460,

  open: (folder, path) => {
    const tab = { folder, path };
    const key = tabKey(tab);
    set((state) => ({ tabs: state.tabs.some((t) => tabKey(t) === key) ? state.tabs : [...state.tabs, tab].slice(-MAX_TABS), active: key }));
  },

  navigate: (tab, path) => {
    const next = { folder: tab.folder, path };
    if (get().tabs.some((t) => tabKey(t) === tabKey(next))) return get().open(tab.folder, path);
    set((state) => ({ tabs: state.tabs.map((t) => (tabKey(t) === tabKey(tab) ? next : t)), active: tabKey(next) }));
  },

  close: (tab) => {
    const key = tabKey(tab);
    set((state) => {
      const at = state.tabs.findIndex((t) => tabKey(t) === key);
      const tabs = state.tabs.filter((t) => tabKey(t) !== key);
      const mine = tabs.filter((t) => t.folder === tab.folder);
      const neighbour = mine[Math.min(Math.max(at - 1, 0), mine.length - 1)];
      return { tabs, active: state.active === key ? (neighbour ? tabKey(neighbour) : null) : state.active };
    });
  },

  setWidth: (width) => {
    save("panel.width", clampWidth(width));
    set({ width: clampWidth(width) });
  },
}));
