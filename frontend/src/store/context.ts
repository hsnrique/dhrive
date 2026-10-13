import { create } from "zustand";

import { compactSession, contextUsage, type ContextUsage, type Engine, type SessionRef } from "@/lib/api";

// How full each of a conversation's CLI sessions is, read when the conversation opens and after each
// run, and the compactions the owner starts. A run on a session being compacted waits for the
// compaction to end (runs.ts), so the two never touch the session at once.

export interface SeenContext {
  value: ContextUsage | null;
  error: string | null;
  reading: boolean;
  compacting: boolean;
  // How the last compaction went ("Compacted.", or why it didn't).
  note: string | null;
}

const IDLE: SeenContext = { value: null, error: null, reading: false, compacting: false, note: null };

export const contextKey = (engine: Engine, session: string) => `${engine}:${session}`;

const compactions = new Map<string, Promise<void>>();
// Bumped by each compaction, so a read that started before one can't replace what it found.
const generations = new Map<string, number>();

export const compactionOf = (engine: Engine, session: string) => compactions.get(contextKey(engine, session));

interface ContextState {
  seen: Record<string, SeenContext>;
  read: (session: SessionRef) => Promise<void>;
  compact: (session: SessionRef) => Promise<void>;
}

export const useContextUsage = create<ContextState>((set, get) => {
  const put = (key: string, next: Partial<SeenContext>) => set((state) => ({ seen: { ...state.seen, [key]: { ...IDLE, ...state.seen[key], ...next } } }));
  return {
    seen: {},

    read: async (session) => {
      const key = contextKey(session.engine, session.session);
      const now = get().seen[key];
      if (now?.reading || now?.compacting) return;
      put(key, { reading: true });
      const generation = generations.get(key);
      try {
        const value = await contextUsage(session);
        put(key, generations.get(key) === generation ? { value, error: null, reading: false } : { reading: false });
      } catch (error) {
        put(key, { error: String(error), reading: false });
      }
    },

    // Codex only counts again on its next turn, so its new size shows then.
    compact: (session) => {
      const key = contextKey(session.engine, session.session);
      const running = compactions.get(key);
      if (running) return running;
      generations.set(key, (generations.get(key) ?? 0) + 1);
      put(key, { compacting: true, note: null });
      const done = compactSession(session)
        .then(
          (value) => put(key, value ? { value, note: "Compacted." } : { note: "Compacted. The new size shows after the next request." }),
          (error) => put(key, { note: String(error) }),
        )
        .finally(() => {
          compactions.delete(key);
          put(key, { compacting: false });
        });
      compactions.set(key, done);
      return done;
    },
  };
});
