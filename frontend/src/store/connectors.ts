import { create } from "zustand";

import { connectors as listConnectors, readCompanyRecord, saveCompanyRecord, type Connector } from "@/lib/api";
import { useApp } from "./app";

// The tools each company has connected (connectors.rs runs their setups), kept in its folder
// (.company/connectors.json) so the record goes with the company, and so its agents are told to use
// them on every step. A setup counts once its script finishes without an error.

export type Connected = Record<string, { at: number }>;

const connectedIn = (value: unknown): Connected => {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value as Record<string, { at?: unknown }>).filter(([, c]) => typeof c?.at === "number")) as Connected;
};

interface ConnectorsState {
  catalog: Connector[];
  byProject: Record<string, Connected>;
  load: (projectId: string) => Promise<void>;
  connected: (projectId: string, id: string) => Promise<void>;
}

export const useConnectors = create<ConnectorsState>((set, get) => {
  const put = (projectId: string, connected: Connected) => set({ byProject: { ...get().byProject, [projectId]: connected } });
  return {
    catalog: [],
    byProject: {},
    load: async (projectId) => {
      try {
        if (get().catalog.length === 0) set({ catalog: await listConnectors() });
        put(projectId, connectedIn(await readCompanyRecord(projectId, "connectors")));
      } catch {
        // An unreadable record shows nothing connected and is never written over by a load.
      }
    },
    // Read again right before writing, merged, so a file that can't be read is never written over.
    connected: async (projectId, id) => {
      const mark = { [id]: { at: Date.now() } };
      put(projectId, { ...(get().byProject[projectId] ?? {}), ...mark });
      try {
        const next = { ...connectedIn(await readCompanyRecord(projectId, "connectors")), ...mark };
        await saveCompanyRecord(projectId, "connectors", next);
        put(projectId, next);
      } catch (error) {
        // Connected all the same (the tool's own CLI holds the sign-in); only dhrive's note of it is
        // missing, so it would show as not connected next time. Said, not swallowed.
        useApp.getState().reportError(`Connected, but dhrive couldn't note it in the company's folder: ${String(error)}`);
      }
    },
  };
});

export const useConnectedOf = (projectId: string) => useConnectors((s) => s.byProject[projectId]);
