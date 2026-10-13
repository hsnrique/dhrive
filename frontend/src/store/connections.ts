import { create } from "zustand";

import { listConnections, type Connections, type Engine } from "@/lib/api";

// What each CLI has connected, per project folder, asked again every time its screen opens. The last
// answer shows meanwhile, since asking takes a few seconds (MCP servers have to connect first).

export interface SeenConnections {
  value: Connections | null;
  error: string | null;
  loading: boolean;
}

interface ConnectionsState {
  seen: Record<string, SeenConnections>;
  refresh: (engine: Engine, folder: string) => Promise<void>;
}

const NOT_ASKED: SeenConnections = { value: null, error: null, loading: false };

export const connectionsKey = (engine: Engine, folder: string) => `${engine}\n${folder}`;

export const useConnections = create<ConnectionsState>((set, get) => ({
  seen: {},

  refresh: async (engine, folder) => {
    const key = connectionsKey(engine, folder);
    if (get().seen[key]?.loading) return;
    const put = (next: Partial<SeenConnections>) => set((state) => ({ seen: { ...state.seen, [key]: { ...NOT_ASKED, ...state.seen[key], ...next } } }));
    put({ loading: true });
    try {
      put({ value: await listConnections(engine, folder), error: null, loading: false });
    } catch (error) {
      put({ error: String(error), loading: false });
    }
  },
}));
