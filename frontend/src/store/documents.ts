import { create } from "zustand";

import { readDocuments } from "@/lib/api";
import { DOCUMENTS, documentPrompt, taskTitle, type DocumentId } from "@/lib/documents";
import { useDay } from "./day";

// What each company's documents say, read from its docs/ when its page opens and again as tasks
// finish. Writing one is queueing a task for the company's agent, unless one is already queued.

type Written = Record<string, string | null>;

interface DocumentsState {
  byProject: Record<string, Written>;
  load: (projectId: string) => Promise<void>;
  write: (projectId: string, ids: DocumentId[]) => void;
}

// A document's task waiting or under way, if there is one.
export const writing = (projectId: string, id: DocumentId) => {
  const kind = DOCUMENTS.find((k) => k.id === id)!;
  return (useDay.getState().byProject[projectId]?.tasks ?? []).some((t) => (t.status === "planned" || t.status === "running") && t.title === taskTitle(kind));
};

export const useDocuments = create<DocumentsState>((set, get) => ({
  byProject: {},
  load: async (projectId) => {
    try {
      const docs = await readDocuments(projectId);
      set({ byProject: { ...get().byProject, [projectId]: Object.fromEntries(docs.map((d) => [d.id, d.text])) } });
    } catch {
      // A folder that went away reads as nothing written; the page says so.
      set({ byProject: { ...get().byProject, [projectId]: {} } });
    }
  },
  write: (projectId, ids) => {
    for (const kind of DOCUMENTS.filter((k) => ids.includes(k.id) && !writing(projectId, k.id))) {
      useDay.getState().add(projectId, documentPrompt(kind), kind.area);
    }
  },
}));
