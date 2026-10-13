import { create } from "zustand";

import { MAX_ENTRIES, savedLog, type Entry } from "@/lib/log";
import { readSaved } from "@/lib/storage";
import { keeper } from "./records";

// Each company's timeline, kept in its log record (records.rs): the latest entries there, older ones
// in its archive. Anything that happens to a company writes here; the company's chat reads it.

// Where timelines lived before the record: read once to move each company's over, never written again.
// ponytail: left in the webview's storage; clear it once every install has moved (0.4.x).
const LEGACY_KEY = "company.log";

function legacyLogs(): Record<string, unknown> {
  const value = readSaved(LEGACY_KEY);
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

// Both sides' entries, once each, in the order they happened.
export function mergedLog(saved: Entry[], now: Entry[]): Entry[] {
  const here = new Set(now.map((e) => e.id));
  return [...saved.filter((e) => !here.has(e.id)), ...now].sort((a, b) => a.at - b.at);
}

interface LogState {
  byProject: Record<string, Entry[]>;
  add: (projectId: string, entry: Entry) => void;
  update: (projectId: string, id: string, change: Partial<Entry>) => void;
}

export const useLog = create<LogState>((set, get) => {
  const legacy = legacyLogs();
  const record = keeper("log", (projectId) => get().byProject[projectId] ?? [], (projectId, saved) => {
    if (saved === null && !(projectId in legacy)) return false;
    const fromFile = savedLog(saved ?? legacy[projectId]);
    const now = get().byProject[projectId];
    set({ byProject: { ...get().byProject, [projectId]: now ? mergedLog(fromFile, now) : fromFile } });
    return saved === null || now !== undefined;
  });
  const write = (projectId: string, entries: Entry[]) => {
    const latest = entries.slice(-MAX_ENTRIES);
    set({ byProject: { ...get().byProject, [projectId]: latest } });
    record.persist(projectId, entries.slice(0, entries.length - latest.length));
  };
  return {
    byProject: {},
    add: (projectId, entry) => write(projectId, [...(get().byProject[projectId] ?? []), entry]),
    update: (projectId, id, change) => write(projectId, (get().byProject[projectId] ?? []).map((e) => (e.id === id ? { ...e, ...change } : e))),
  };
});

const NONE: Entry[] = [];
export const useLogOf = (projectId: string) => useLog((s) => s.byProject[projectId] ?? NONE);
