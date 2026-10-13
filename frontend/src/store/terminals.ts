import { create } from "zustand";

import type { Engine } from "@/lib/api";
import { readSaved, save } from "@/lib/storage";

// Terminals sessions: each one belongs to a project, as a conversation does, and holds a grid of
// panes, each running one CLI in that project. The sessions and their panes are remembered; the
// CLIs in them start fresh each time dhrive opens. `run` counts restarts, so a pane keyed on it
// starts its CLI again.

export interface Pane {
  id: string;
  engine: Engine;
  // The CLI's own default when empty.
  model: string;
  // Works in a git worktree of its own instead of the project folder.
  copy: boolean;
  // The maestro's subtask, sent as the CLI's first message the first time it starts.
  task: string | null;
  // The subtask's title, which names the pane's work when it's brought together.
  title: string;
  run: number;
}

// What the maestro hands over for each pane it opens.
export interface Launch {
  engine: Engine;
  model: string;
  task: string;
  title: string;
  // A pane with a set id works in that id's copy, or with `copy: false`, in the project folder itself.
  id?: string;
  copy?: boolean;
}

export interface TerminalSession {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  panes: Pane[];
}

export const MAX_PANES = 6;
export const NEW_TITLE = "Terminals";
const MAX_TITLE = 80;
const KEY = "terminals.sessions";
// Before sessions, one grid whose panes each named their own project.
const OLD_KEY = "terminals.panes";

const newPane = (engine: Engine, launch?: Launch): Pane => ({ id: launch?.id ?? crypto.randomUUID(), engine, model: launch?.model ?? "", copy: launch !== undefined && launch.copy !== false, task: launch?.task || null, title: launch?.title ?? "", run: 0 });

const isPane = (p: unknown): p is Pane => typeof (p as Pane)?.id === "string" && typeof (p as Pane)?.engine === "string";
const paneOf = (p: Pane): Pane => ({ id: p.id, engine: p.engine, model: typeof p.model === "string" ? p.model : "", copy: p.copy === true, task: typeof p.task === "string" && p.copy === true ? p.task : null, title: typeof p.title === "string" ? p.title : "", run: 0 });

function sessionOf(raw: unknown): TerminalSession | null {
  const s = raw as Partial<TerminalSession> | null;
  if (typeof s?.id !== "string" || typeof s.projectId !== "string") return null;
  const panes = Array.isArray(s.panes) ? s.panes.filter(isPane).slice(0, MAX_PANES).map(paneOf) : [];
  const at = typeof s.updatedAt === "number" ? s.updatedAt : 0;
  return { id: s.id, projectId: s.projectId, title: typeof s.title === "string" && s.title.trim() ? s.title : NEW_TITLE, createdAt: typeof s.createdAt === "number" ? s.createdAt : at, updatedAt: at, panes };
}

// The old grid becomes one session per project its panes were in.
function migrated(old: unknown): TerminalSession[] {
  if (!Array.isArray(old)) return [];
  const byProject = new Map<string, Pane[]>();
  for (const p of old.filter(isPane) as (Pane & { projectId?: unknown })[]) {
    if (typeof p.projectId === "string") byProject.set(p.projectId, [...(byProject.get(p.projectId) ?? []), paneOf(p)]);
  }
  const now = Date.now();
  return [...byProject].map(([projectId, panes]) => ({ id: crypto.randomUUID(), projectId, title: NEW_TITLE, createdAt: now, updatedAt: now, panes: panes.slice(0, MAX_PANES) }));
}

export function restored(saved: unknown, old: unknown): TerminalSession[] {
  if (Array.isArray(saved)) return saved.map(sessionOf).filter((s): s is TerminalSession => s !== null);
  return migrated(old);
}

interface TerminalsState {
  sessions: TerminalSession[];
  // The session on screen when the Terminals page is.
  openId: string | null;
  create: (projectId: string) => string;
  rename: (id: string, title: string) => void;
  drop: (id: string) => void;
  add: (sessionId: string, engine: Engine) => void;
  // The maestro's approved subtasks, each as a pane in its own copy; false when they don't fit.
  launch: (sessionId: string, launches: Launch[]) => boolean;
  started: (paneId: string) => void;
  change: (paneId: string, patch: Partial<Pick<Pane, "engine" | "model" | "copy">>) => void;
  restart: (paneId: string) => void;
  remove: (paneId: string) => void;
}

const stored = (sessions: TerminalSession[]) => sessions.map(({ panes, ...session }) => ({ ...session, panes: panes.map(({ run: _, ...pane }) => pane) }));

export const useTerminals = create<TerminalsState>((set, get) => {
  const update = (sessions: (current: TerminalSession[]) => TerminalSession[]) =>
    set((state) => {
      const next = sessions(state.sessions);
      save(KEY, stored(next));
      return { sessions: next };
    });
  // A pane changed: its session moves up the project's list, as a conversation does.
  const onPanes = (where: (s: TerminalSession) => boolean, panes: (current: Pane[]) => Pane[]) =>
    update((sessions) => sessions.map((s) => (where(s) ? { ...s, panes: panes(s.panes), updatedAt: Date.now() } : s)));
  const holding = (paneId: string) => (s: TerminalSession) => s.panes.some((p) => p.id === paneId);
  return {
    sessions: restored(readSaved(KEY), readSaved(OLD_KEY)),
    openId: null,
    create: (projectId) => {
      const now = Date.now();
      const session: TerminalSession = { id: crypto.randomUUID(), projectId, title: NEW_TITLE, createdAt: now, updatedAt: now, panes: [] };
      update((sessions) => [session, ...sessions]);
      return session.id;
    },
    rename: (id, title) => update((sessions) => sessions.map((s) => (s.id === id && title.trim() ? { ...s, title: title.trim().slice(0, MAX_TITLE) } : s))),
    drop: (id) => {
      update((sessions) => sessions.filter((s) => s.id !== id));
      set((state) => (state.openId === id ? { openId: null } : state));
    },
    add: (sessionId, engine) => onPanes((s) => s.id === sessionId && s.panes.length < MAX_PANES, (panes) => [...panes, newPane(engine)]),
    launch: (sessionId, launches) => {
      const session = get().sessions.find((s) => s.id === sessionId);
      const taken = launches.some((l) => l.id && session?.panes.some((p) => p.id === l.id));
      if (!session || taken || launches.length === 0 || session.panes.length + launches.length > MAX_PANES) return false;
      onPanes((s) => s.id === sessionId, (panes) => [...panes, ...launches.map((l) => newPane(l.engine, l))]);
      return true;
    },
    started: (paneId) => update((sessions) => sessions.map((s) => ({ ...s, panes: s.panes.map((p) => (p.id === paneId && p.task !== null ? { ...p, task: null } : p)) }))),
    // Another CLI doesn't know the last one's models.
    change: (paneId, patch) => onPanes(holding(paneId), (panes) => panes.map((p) => (p.id === paneId ? { ...p, ...(patch.engine && patch.engine !== p.engine ? { model: "" } : {}), ...patch, run: p.run + 1 } : p))),
    restart: (paneId) => onPanes(holding(paneId), (panes) => panes.map((p) => (p.id === paneId ? { ...p, run: p.run + 1 } : p))),
    remove: (paneId) => onPanes(holding(paneId), (panes) => panes.filter((p) => p.id !== paneId)),
  };
});

// Side by side up to three, then a 2×2, then three across: no grid leaves a hole.
export const columnsFor = (count: number) => (count === 4 ? 2 : Math.min(count, 3) || 1);
