import { create } from "zustand";

import { searchConversations, type SearchHit } from "@/lib/api";

// ⌘K: whether it's open, and the backend's matches inside conversations for what was typed. Only the
// answer to the latest query is kept, so a slow answer to an earlier one can't replace it.

interface SearchState {
  open: boolean;
  hits: SearchHit[];
  hitsFor: string;
  setOpen: (open: boolean) => void;
  find: (query: string) => Promise<void>;
}

let latest = 0;

export const useSearch = create<SearchState>((set) => ({
  open: false,
  hits: [],
  hitsFor: "",

  setOpen: (open) => set({ open }),

  find: async (query) => {
    const asked = ++latest;
    if (query.trim().length < 2) return set({ hits: [], hitsFor: query });
    let hits: SearchHit[] = [];
    try {
      hits = await searchConversations(query);
    } catch {
      // Titles still match without it; a failed search of the text just finds nothing more.
    }
    if (asked === latest) set({ hits, hitsFor: query });
  },
}));
