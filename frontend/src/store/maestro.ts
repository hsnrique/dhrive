import { create } from "zustand";

import { runStep, stopRun, type Engine } from "@/lib/api";
import { titleFor } from "@/lib/conversations";
import { parseSplit, savedParts, withFocus, type Focus, type Part } from "@/lib/maestro";
import { readSaved, save } from "@/lib/storage";
import { useApp } from "./app";
import { NEW_TITLE, useTerminals } from "./terminals";

// The maestro of each Terminals session: one brief, split by a CLI and model of the owner's choice
// into subtasks the owner reviews before anything opens. The split only reads the session's
// project; nothing runs until the owner says so. A session keeps its brief and split, run or not,
// until the owner clears them or closes the session.

const NOTHING = "The maestro didn't return any subtasks. Try again, or say more about the task.";
const KEY = "maestro.drafts";

export interface Draft {
  open: boolean;
  engine: Engine | null;
  model: string;
  brief: string;
  focus: Focus[];
  // The split in flight, whose progress is in the app's live log under this id.
  runId: string | null;
  parts: Part[];
  // When the owner last ran the split.
  ranAt: number | null;
  error: string | null;
}

export const EMPTY: Draft = { open: false, engine: null, model: "", brief: "", focus: [], runId: null, parts: [], ranAt: null, error: null };

const isFocus = (f: unknown): f is Focus => ["skill", "server", "plugin"].includes((f as Focus)?.kind) && typeof (f as Focus)?.name === "string";

export function savedDrafts(value: unknown): Record<string, Draft> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, Partial<Draft>>).map(([session, d]) => [
      session,
      {
        ...EMPTY,
        engine: typeof d?.engine === "string" ? d.engine : null,
        model: typeof d?.model === "string" ? d.model : "",
        brief: typeof d?.brief === "string" ? d.brief : "",
        focus: Array.isArray(d?.focus) ? d.focus.filter(isFocus) : [],
        parts: savedParts(d?.parts),
        ranAt: typeof d?.ranAt === "number" ? d.ranAt : null,
      },
    ]),
  );
}

const kept = (bySession: Record<string, Draft>) => Object.fromEntries(Object.entries(bySession).map(([id, { engine, model, brief, focus, parts, ranAt }]) => [id, { engine, model, brief, focus, parts, ranAt }]));

interface MaestroState {
  bySession: Record<string, Draft>;
  set: (session: string, patch: Partial<Pick<Draft, "open" | "engine" | "model" | "brief" | "focus">>) => void;
  split: (session: string, usable: Engine[]) => Promise<void>;
  stop: (session: string) => void;
  edit: (session: string, id: string, patch: Partial<Omit<Part, "id">>) => void;
  drop: (session: string, id: string) => void;
  clear: (session: string) => void;
  forget: (session: string) => void;
  // The owner's OK: each subtask opens as a pane in its own copy, already at work.
  run: (session: string) => boolean;
}

const folderOf = (session: string) => {
  const projectId = useTerminals.getState().sessions.find((s) => s.id === session)?.projectId;
  return useApp.getState().projects.find((p) => p.id === projectId)?.folder;
};

// An unnamed session takes its name from the brief, as a conversation does from its request.
function nameAfter(session: string, brief: string) {
  const terminals = useTerminals.getState();
  if (terminals.sessions.find((s) => s.id === session)?.title === NEW_TITLE) terminals.rename(session, titleFor(brief));
}

export const useMaestro = create<MaestroState>((set, get) => {
  const draft = (session: string) => get().bySession[session] ?? EMPTY;
  const write = (bySession: Record<string, Draft>) => {
    save(KEY, kept(bySession));
    set({ bySession });
  };
  const patch = (session: string, change: (d: Draft) => Partial<Draft>) => write({ ...get().bySession, [session]: { ...draft(session), ...change(draft(session)) } });
  return {
    bySession: savedDrafts(readSaved(KEY)),
    set: (session, change) => patch(session, () => change),
    split: async (session, usable) => {
      const { brief, model, focus, runId: busy } = draft(session);
      const engine = draft(session).engine ?? usable[0];
      const folder = folderOf(session);
      if (!folder || !engine || !brief.trim() || busy) return;
      const runId = crypto.randomUUID();
      patch(session, () => ({ runId, parts: [], ranAt: null, error: null }));
      nameAfter(session, brief);
      try {
        const result = await runStep({ runId, folder, step: "split", engine, model, task: withFocus(brief, focus) });
        if (draft(session).runId !== runId) return;
        const parts = parseSplit(result.output, usable, engine);
        patch(session, () => ({ runId: null, parts, error: parts.length ? null : NOTHING }));
      } catch (error) {
        if (draft(session).runId === runId) patch(session, () => ({ runId: null, error: String(error) }));
      }
    },
    stop: (session) => {
      const { runId } = draft(session);
      if (!runId) return;
      patch(session, () => ({ runId: null }));
      void stopRun(runId);
    },
    edit: (session, id, change) => patch(session, (d) => ({ parts: d.parts.map((p) => (p.id === id ? { ...p, ...change } : p)) })),
    drop: (session, id) => patch(session, (d) => ({ parts: d.parts.filter((p) => p.id !== id) })),
    clear: (session) => patch(session, () => ({ parts: [], ranAt: null, error: null, brief: "" })),
    forget: (session) => write(Object.fromEntries(Object.entries(get().bySession).filter(([id]) => id !== session))),
    run: (session) => {
      const launches = draft(session).parts.filter((p) => p.prompt.trim()).map((p) => ({ engine: p.engine, model: p.model, task: p.prompt, title: p.title }));
      if (!useTerminals.getState().launch(session, launches)) return false;
      patch(session, () => ({ open: false, ranAt: Date.now() }));
      return true;
    },
  };
});

export const useDraft = (session: string) => useMaestro((s) => s.bySession[session] ?? EMPTY);
