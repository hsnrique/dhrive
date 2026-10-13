import { create } from "zustand";

import { planUsage, type Engine } from "@/lib/api";
import { readSaved, save } from "@/lib/storage";
import { restoreUsage, type KnownUsage } from "@/lib/usage";

// Each CLI's plan usage, asked of the CLI every time the owner looks. The last answer stays, across
// launches too, so the card shows something at once while the fresh one is on its way.

// Hovering out and back in right away doesn't start the CLI again.
const FRESH_MS = 5_000;

interface UsageState {
  known: Partial<Record<Engine, KnownUsage>>;
  reading: Partial<Record<Engine, boolean>>;
  failed: Partial<Record<Engine, string>>;
  // `force` is the owner asking again, which skips the few seconds an answer counts as fresh.
  refresh: (engine: Engine, force?: boolean) => Promise<void>;
}

export const useUsage = create<UsageState>((set, get) => ({
  known: restoreUsage(readSaved("usage")),
  reading: {},
  failed: {},

  refresh: async (engine, force = false) => {
    const { known, reading } = get();
    if (reading[engine] || (!force && Date.now() - (known[engine]?.at ?? 0) < FRESH_MS)) return;
    set((state) => ({ reading: { ...state.reading, [engine]: true } }));
    try {
      const usage = await planUsage(engine);
      const next = { ...get().known, [engine]: { usage, at: Date.now() } };
      save("usage", next);
      set((state) => ({ known: next, failed: { ...state.failed, [engine]: undefined } }));
    } catch (error) {
      set((state) => ({ failed: { ...state.failed, [engine]: String(error) } }));
    } finally {
      set((state) => ({ reading: { ...state.reading, [engine]: false } }));
    }
  },
}));
