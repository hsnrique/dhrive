import { create } from "zustand";

import { readInstructions, saveInstructions } from "@/lib/api";
import { useApp } from "./app";

// The owner's instructions for every agent in every project. Null until the backend has answered.

interface InstructionsState {
  everyProject: string | null;
  load: () => Promise<void>;
  save: (text: string) => Promise<void>;
}

export const useInstructions = create<InstructionsState>((set) => ({
  everyProject: null,

  load: async () => {
    try {
      set({ everyProject: await readInstructions() });
    } catch (error) {
      useApp.getState().reportError(error);
    }
  },

  // Kept at once, so reopening the editor shows it; a failed save throws, so the editor can say so.
  save: async (text) => {
    set({ everyProject: text });
    await saveInstructions(text);
  },
}));
