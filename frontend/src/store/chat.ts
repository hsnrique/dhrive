import { create } from "zustand";

import { runStep, stopRun, type Engine } from "@/lib/api";
import { entry, news, parseReply } from "@/lib/log";
import { readSaved, save } from "@/lib/storage";
import { useApp } from "./app";
import { companyAgent } from "./company";
import { useDay } from "./day";
import { useLog } from "./log";

// Each company's chat with its agent. The agent answers reading only, in one CLI session kept per
// company, so each turn sends just the owner's words and what happened since it last spoke. Work it
// suggests is added by the owner, one task at a time, and starts like any task they add.

const KEY = "company.chat";

interface Session {
  id: string;
  engine: Engine;
}

export interface Talk {
  runId: string | null;
  error: string | null;
}

export const QUIET: Talk = { runId: null, error: null };

function savedSessions(value: unknown): Record<string, Session> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value as Record<string, Partial<Session>>).filter(([, s]) => typeof s?.id === "string" && typeof s.engine === "string") as [string, Session][]);
}

interface ChatState {
  byProject: Record<string, Talk>;
  sessions: Record<string, Session>;
  ask: (projectId: string, said: string) => Promise<void>;
  stop: (projectId: string) => void;
  addTask: (projectId: string, entryId: string, taskId: string) => void;
}

export const useChat = create<ChatState>((set, get) => {
  const put = (projectId: string, talk: Talk) => set({ byProject: { ...get().byProject, [projectId]: talk } });
  const keep = (projectId: string, session: Session) => {
    const sessions = { ...get().sessions, [projectId]: session };
    save(KEY, sessions);
    set({ sessions });
  };
  const log = () => useLog.getState();

  return {
    byProject: {},
    sessions: savedSessions(readSaved(KEY)),
    ask: async (projectId, said) => {
      const words = said.trim();
      const project = useApp.getState().projects.find((p) => p.id === projectId);
      const agent = companyAgent(projectId);
      if (!words || !project || !agent || get().byProject[projectId]?.runId) return;
      const before = news(log().byProject[projectId] ?? []);
      log().add(projectId, entry("owner", words));
      const runId = crypto.randomUUID();
      put(projectId, { runId, error: null });
      // A session belongs to the CLI that started it; a new agent starts a new one.
      const session = get().sessions[projectId];
      const resume = session?.engine === agent.engine ? session.id : undefined;
      try {
        const result = await runStep({ runId, folder: project.folder, step: "talk", engine: agent.engine, model: agent.model, effort: agent.effort, task: [before, words].filter(Boolean).join("\n\n"), resume });
        if (get().byProject[projectId]?.runId !== runId) return;
        const { text, tasks } = parseReply(result.output, agent);
        log().add(projectId, entry("agent", text, tasks.length ? { tasks, added: [] } : {}));
        if (result.sessionId) keep(projectId, { id: result.sessionId, engine: agent.engine });
        put(projectId, QUIET);
      } catch (error) {
        if (get().byProject[projectId]?.runId === runId) put(projectId, { runId: null, error: String(error) });
      }
    },
    stop: (projectId) => {
      const runId = get().byProject[projectId]?.runId;
      if (!runId) return;
      put(projectId, QUIET);
      void stopRun(runId);
    },
    addTask: (projectId, entryId, taskId) => {
      const said = (log().byProject[projectId] ?? []).find((e) => e.id === entryId);
      const task = said?.tasks?.find((t) => t.id === taskId);
      if (!said || !task || said.added?.includes(taskId)) return;
      useDay.getState().queue(projectId, task);
      log().update(projectId, entryId, { added: [...(said.added ?? []), taskId] });
    },
  };
});

export const useTalkOf = (projectId: string) => useChat((s) => s.byProject[projectId] ?? QUIET);
