import { create } from "zustand";

import { bringPanesTogether, openTogetherPullRequest, type Together } from "@/lib/api";
import { useTerminals, type TerminalSession } from "./terminals";

// Bringing a Terminals session's panes together on one branch, in the project folder itself. A pane
// opened there, to resolve a conflict or review the result, has the session's id, so it's never one
// of the panes being brought in.

type Merge = Together["merges"][number];

export interface Gathering {
  busy: boolean;
  result: Together | null;
  error: string | null;
  // The pull request opened from the branch they were brought onto.
  pullRequest: string | null;
}

const IDLE: Gathering = { busy: false, result: null, error: null, pullRequest: null };

// The panes whose work counts: each in a copy of its own, and not the one open on the result.
export const workPanes = (session: TerminalSession) => session.panes.filter((p) => p.copy && p.id !== session.id);

export function resolveTask(merge: Merge, title: string): string {
  return `Merge the branch ${merge.branch} ("${title}") into the current branch. Git stops on conflicts in: ${merge.files.join(", ")}. Resolve them keeping what both sides meant, run the project's checks, then commit the merge.`;
}

interface TogetherState {
  bySession: Record<string, Gathering>;
  bring: (session: TerminalSession) => Promise<void>;
  pullRequest: (session: TerminalSession) => Promise<void>;
  // A pane in the project folder: to resolve one conflict, or with no task, to look the result over.
  openOnIt: (session: TerminalSession, merge?: Merge) => boolean;
  dismiss: (session: string) => void;
}

export const useTogether = create<TogetherState>((set, get) => {
  const patch = (session: string, change: Partial<Gathering>) => set((state) => ({ bySession: { ...state.bySession, [session]: { ...IDLE, ...state.bySession[session], ...change } } }));
  return {
    bySession: {},
    bring: async (session) => {
      const parts = workPanes(session).map((p, at) => ({ pane: p.id, title: p.title || `Pane ${at + 1}` }));
      if (parts.length === 0 || get().bySession[session.id]?.busy) return;
      patch(session.id, { busy: true, error: null, pullRequest: null });
      try {
        patch(session.id, { busy: false, result: await bringPanesTogether(session.projectId, session.id, parts) });
      } catch (error) {
        patch(session.id, { busy: false, error: String(error) });
      }
    },
    pullRequest: async (session) => {
      patch(session.id, { busy: true, error: null });
      try {
        patch(session.id, { busy: false, pullRequest: await openTogetherPullRequest(session.projectId) });
      } catch (error) {
        patch(session.id, { busy: false, error: String(error) });
      }
    },
    openOnIt: (session, merge) => {
      const pane = merge && session.panes.find((p) => p.id === merge.pane);
      const engine = pane?.engine ?? session.panes[0]?.engine;
      if (!engine) return false;
      const title = pane?.title || "Merge";
      return useTerminals.getState().launch(session.id, [{ id: session.id, copy: false, engine, model: pane?.model ?? "", task: merge ? resolveTask(merge, title) : "", title }]);
    },
    dismiss: (session) => set((state) => ({ bySession: Object.fromEntries(Object.entries(state.bySession).filter(([id]) => id !== session)) })),
  };
});
