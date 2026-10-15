import { create } from "zustand";

import { readCompanyRecord, saveCompanyRecord } from "@/lib/api";
import { favoriteAddress } from "@/lib/domains";
import { readSaved } from "@/lib/storage";
import { useApp } from "./app";
import { useDomainsOf } from "./domains";
import { usePublishedOf } from "./publish";

// Which of a company's addresses the owner starred: the one the toolbar and the Website section open.
// It lives in the company's folder (.company/site.json), so every install of dhrive and every Mac
// the folder reaches opens the same one; it was once kept in this webview alone, which another
// install never sees. One that's gone or not live yet falls back to the site's own.

const LEGACY_KEY = "site.favorite";

const favoriteIn = (value: unknown): string | null => {
  const favorite = (value as { favorite?: unknown } | null)?.favorite;
  return typeof favorite === "string" && favorite.length > 0 ? favorite : null;
};

function legacyFavorites(): Record<string, string> {
  const value = readSaved(LEGACY_KEY);
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
}

interface FavoriteState {
  byProject: Record<string, string>;
  load: (projectId: string) => Promise<void>;
  pick: (projectId: string, host: string) => void;
}

export const useFavorite = create<FavoriteState>((set, get) => {
  const keep = (projectId: string, host: string) => set({ byProject: { ...get().byProject, [projectId]: host } });
  return {
    // What this webview remembered shows until the folder's answer arrives.
    byProject: legacyFavorites(),
    load: async (projectId) => {
      try {
        const saved = favoriteIn(await readCompanyRecord(projectId, "site"));
        const legacy = legacyFavorites()[projectId];
        if (saved) keep(projectId, saved);
        // A star from before the folder kept it moves there once, the first time the company opens.
        else if (legacy) await saveCompanyRecord(projectId, "site", { favorite: legacy });
      } catch {
        // An unreadable record leaves the remembered star in place; it's never written over.
      }
    },
    pick: (projectId, host) => {
      const before = get().byProject[projectId];
      keep(projectId, host);
      void saveCompanyRecord(projectId, "site", { favorite: host }).catch((error) => {
        if (before) keep(projectId, before);
        else set({ byProject: Object.fromEntries(Object.entries(get().byProject).filter(([id]) => id !== projectId)) });
        useApp.getState().reportError(`Couldn't keep the starred address: ${String(error)}`);
      });
    },
  };
});

export function useAddress(projectId: string): string | null {
  const { url } = usePublishedOf(projectId);
  const { domains } = useDomainsOf(projectId);
  const favorite = useFavorite((s) => s.byProject[projectId]);
  return favoriteAddress(url, favorite, domains);
}
