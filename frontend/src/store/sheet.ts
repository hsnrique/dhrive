import { create } from "zustand";

// The website's sheet over a company's page (SitePreview): the published site, from its preview, or
// the one running on this Mac, from Play. One at a time.

export type SheetSite = "live" | "local";

interface SheetState {
  open: { projectId: string; site: SheetSite } | null;
  show: (projectId: string, site: SheetSite) => void;
  close: () => void;
}

export const useSheet = create<SheetState>((set) => ({
  open: null,
  show: (projectId, site) => set({ open: { projectId, site } }),
  close: () => set({ open: null }),
}));
