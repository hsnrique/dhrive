import { create } from "zustand";

import { notify } from "@/lib/api";
import { nextStatus, STARTED, type PaneEvent, type PaneStatus } from "@/lib/terminal-status";

// Each Terminals pane's status and the title its CLI gave its window. A pane that turns to the owner
// while dhrive isn't in front gets a notification, as a conversation's request does.

interface PaneStatusState {
  byPane: Record<string, PaneStatus & { title: string }>;
  report: (pane: string, event: PaneEvent, label: string) => void;
  retitle: (pane: string, title: string) => void;
  reset: (pane: string) => void;
}

const MAX_TITLE = 80;

export const usePaneStatus = create<PaneStatusState>((set, get) => ({
  byPane: {},

  report: (pane, event, label) => {
    const before = get().byPane[pane] ?? { ...STARTED, title: "" };
    const after = nextStatus(before, event);
    if (after.state === before.state && after.asked === before.asked) return;
    set((state) => ({ byPane: { ...state.byPane, [pane]: { ...after, title: before.title } } }));
    if (after.state === "needs-you" && before.state !== "needs-you" && !document.hasFocus()) {
      notify(before.title || label, `${label} is waiting for you.`).catch(() => undefined);
    }
  },

  retitle: (pane, title) => {
    const clean = title.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_TITLE);
    set((state) => ({ byPane: { ...state.byPane, [pane]: { ...(state.byPane[pane] ?? STARTED), title: clean } } }));
  },

  reset: (pane) => set((state) => ({ byPane: Object.fromEntries(Object.entries(state.byPane).filter(([id]) => id !== pane)) })),
}));

