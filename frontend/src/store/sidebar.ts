import { useEffect, useState } from "react";
import { create } from "zustand";

import { readSaved, save } from "@/lib/storage";

// The sidebar, open or folded to a rail of companies. A wide window docks it as the owner left it;
// a narrow one keeps the rail and opens the full sidebar over the work, so the work never gets
// squeezed, and it folds back once the owner goes somewhere.

// Below this the docked sidebar would take room the company's columns need.
export const WIDE = "(min-width: 1080px)";
const KEY = "sidebar.open";

export type SidebarMode = "docked" | "rail" | "overlay";

export function sidebarMode(open: boolean, wide: boolean, overlay: boolean): SidebarMode {
  if (wide) return open ? "docked" : "rail";
  return overlay ? "overlay" : "rail";
}

interface SidebarState {
  open: boolean;
  overlay: boolean;
  toggle: (wide: boolean) => void;
  fold: () => void;
}

export const useSidebar = create<SidebarState>((set, get) => ({
  open: readSaved(KEY) !== false,
  overlay: false,
  toggle: (wide) => {
    if (!wide) return set({ overlay: !get().overlay });
    const open = !get().open;
    save(KEY, open);
    set({ open, overlay: false });
  },
  fold: () => set({ overlay: false }),
}));

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const changed = () => setMatches(media.matches);
    changed();
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, [query]);
  return matches;
}

// "PageParcel" → "PP", "sys-app" → "SA", "Cognit" → "Co": two letters, so companies that start alike
// still tell apart on the rail.
export function initialsOf(name: string): string {
  const words = name.trim().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase() + words[0].charAt(1).toLowerCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}
