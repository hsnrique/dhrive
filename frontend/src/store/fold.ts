import { create } from "zustand";

// What the owner unfolded on a company's screen (a task, a document, a list's rest), kept outside the
// cards: when the room changes and a section moves to another column, React builds it anew, and what
// was open has to stay open. Memory only; a new launch starts folded.

interface FoldState {
  open: Record<string, boolean>;
  set: (key: string, open: boolean) => void;
}

export const useFolds = create<FoldState>((set) => ({
  open: {},
  set: (key, open) => set((state) => ({ open: { ...state.open, [key]: open } })),
}));

export function useFold(key: string): [boolean, (next: boolean | ((open: boolean) => boolean)) => void] {
  const open = useFolds((s) => s.open[key] ?? false);
  const change = (next: boolean | ((open: boolean) => boolean)) => {
    const now = useFolds.getState().open[key] ?? false;
    useFolds.getState().set(key, typeof next === "function" ? next(now) : next);
  };
  return [open, change];
}
