import { create } from "zustand";

import { pullModel, scanLocal, startOllama, stopPull, type LocalScan, type PullEvent } from "@/lib/api";
import { useApp } from "./app";

export interface Pull {
  status: string;
  completed: number;
  total: number;
  error: string | null;
}

interface LocalState {
  scan: LocalScan | null;
  // Downloads in flight, and the ones that failed until retried; a finished one leaves.
  pulls: Record<string, Pull>;
  refresh: () => Promise<void>;
  install: (model: string) => Promise<void>;
  stop: (model: string) => void;
  openOllama: () => Promise<void>;
  onPull: (event: PullEvent) => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useLocal = create<LocalState>((set, get) => ({
  scan: null,
  pulls: {},

  refresh: async () => {
    try {
      set({ scan: await scanLocal() });
    } catch (error) {
      useApp.getState().reportError(error);
    }
  },

  install: async (model) => {
    set((s) => ({ pulls: { ...s.pulls, [model]: { status: "starting", completed: 0, total: 0, error: null } } }));
    try {
      await pullModel(model);
      set((s) => {
        const { [model]: _done, ...pulls } = s.pulls;
        return { pulls };
      });
    } catch (error) {
      set((s) => ({ pulls: { ...s.pulls, [model]: { ...s.pulls[model], error: message(error) } } }));
    }
    await get().refresh();
  },

  stop: (model) => void stopPull(model).catch(useApp.getState().reportError),

  // Ollama takes a moment to bring its server up after the app opens.
  openOllama: async () => {
    try {
      await startOllama();
    } catch (error) {
      useApp.getState().reportError(error);
      return;
    }
    for (let attempt = 0; attempt < 10 && get().scan?.ollama !== "running"; attempt++) {
      await pause(1000);
      await get().refresh();
    }
  },

  onPull: ({ model, ...progress }) =>
    set((s) => (s.pulls[model] ? { pulls: { ...s.pulls, [model]: { ...s.pulls[model], ...progress } } } : s)),
}));
