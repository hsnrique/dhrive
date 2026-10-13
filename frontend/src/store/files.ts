import { create } from "zustand";

import { listFiles } from "@/lib/api";
import { indexFiles, type FileIndex } from "@/lib/mentions";

// Each project's files by folder, read when a conversation opens and again after a code step, for
// @-mentions and for spotting the paths a model writes.

interface FilesState {
  byFolder: Record<string, FileIndex>;
  load: (folder: string) => Promise<void>;
}

export const useFiles = create<FilesState>((set) => ({
  byFolder: {},
  load: async (folder) => {
    try {
      const index = indexFiles(await listFiles(folder));
      set((state) => ({ byFolder: { ...state.byFolder, [folder]: index } }));
    } catch {
      // Without the list, mentions aren't suggested or recognized; nothing else depends on it, so
      // the owner isn't interrupted for it.
    }
  },
}));
