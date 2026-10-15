import { create } from "zustand";

import {
  listClis,
  listModels,
  listProjects,
  notify,
  renameProject,
  saveThread,
  type Cli,
  type Engine,
  type ModelOption,
  type ProgressEvent,
  type Project,
  type Question,
  type Step,
} from "@/lib/api";
import { asking, readQuestion } from "@/lib/approvals";
import { readChanges } from "@/lib/changes";
import { restoreChoice, restoreMode, type Choice, type Mode } from "@/lib/flow";
import { readEdit } from "@/lib/linediff";
import { modelName } from "@/lib/names";
import { readSaved, save } from "@/lib/storage";
import { emptyThread, withRunChanges, withRunSession, type Thread } from "@/lib/thread";
import { announce } from "./announce";
import { pushLive } from "./live";


export interface AppState {
  clis: Cli[];
  // What each CLI reported it can run; missing until it has answered once.
  models: Partial<Record<Engine, ModelOption[]>>;
  // The CLIs answered (installed or not); until then nothing says none is installed.
  booted: boolean;
  projects: Project[];
  // The projects were read; until then the sidebar shows no "start a company" for a list still loading.
  projectsRead: boolean;
  // A CLI's own screen (Local models for Ollama; plan and connections for Claude Code and Codex)
  // replaces the project view until a conversation (or Home) is picked.
  // A CLI's own screen, Terminals mode, or a project's company; null is the conversations.
  page: Engine | "terminals" | "company" | null;
  threads: Record<string, Thread>;
  choices: Record<Step, Choice | null>;
  mode: Mode;
  // In Plan mode the code waits for the owner's OK on each plan, unless they chose to skip that.
  autoCode: boolean;
  // Tool calls waiting on the owner's OK, per run id; never saved, a run that ends drops its own.
  approvals: Record<string, Question[]>;
  error: string | null;
  updateReady: string | null;

  boot: () => Promise<void>;
  refreshClis: () => Promise<void>;
  loadModels: (engine: Engine) => Promise<void>;
  openPage: (page: Engine | "terminals" | "company") => void;
  rename: (id: string, name: string) => Promise<void>;
  setThread: (id: string, update: (thread: Thread) => Thread) => void;
  choose: (step: Step, choice: Choice) => void;
  setMode: (mode: Mode) => void;
  setAutoCode: (on: boolean) => void;
  onProgress: (event: ProgressEvent) => void;
  reportError: (error: unknown) => void;
  clearError: () => void;
  setUpdateReady: (version: string | null) => void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useApp = create<AppState>((set, get) => ({
  clis: [],
  models: {},
  booted: false,
  projects: [],
  projectsRead: false,
  page: null,
  threads: {},
  choices: { plan: null, code: null },
  mode: restoreMode(readSaved("mode"), readSaved("planFirst")),
  autoCode: readSaved("autoCode") === true,
  approvals: {},
  error: null,
  updateReady: null,

  // The projects are a file read and the CLIs a probe of each one, which takes far longer: the
  // sidebar fills as soon as the projects are in, and only what needs a CLI waits for the probe.
  boot: async () => {
    const projects = listProjects().then(
      (projects) => set({ projects, projectsRead: true }),
      (error) => {
        set({ projectsRead: true });
        get().reportError(error);
      },
    );
    try {
      const clis = await listClis();
      const choices = { plan: restoreChoice(readSaved("choice.plan"), "plan", clis), code: restoreChoice(readSaved("choice.code"), "code", clis) };
      set({ clis, choices, booted: true });
      clis.filter((cli) => cli.installed).forEach((cli) => void get().loadModels(cli.engine));
    } catch (error) {
      set({ booted: true });
      get().reportError(error);
    }
    await projects;
  },

  // A CLI that updated while dhrive was open is asked for its models again: a new version is how
  // new models usually arrive.
  refreshClis: async () => {
    try {
      const before = get().clis;
      const clis = await listClis();
      set((state) => ({
        clis,
        choices: { plan: state.choices.plan ?? restoreChoice(null, "plan", clis), code: state.choices.code ?? restoreChoice(null, "code", clis) },
      }));
      const changed = clis.filter((cli) => cli.installed && before.find((old) => old.engine === cli.engine)?.version !== cli.version);
      changed.forEach((cli) => void get().loadModels(cli.engine));
    } catch (error) {
      get().reportError(error);
    }
  },

  loadModels: async (engine) => {
    try {
      const options = await listModels(engine);
      set((state) => ({ models: { ...state.models, [engine]: options } }));
    } catch (error) {
      get().reportError(error);
    }
  },

  openPage: (page) => set({ page }),

  rename: async (id, name) => {
    try {
      const project = await renameProject(id, name);
      set((state) => ({ projects: state.projects.map((p) => (p.id === id ? project : p)) }));
    } catch (error) {
      get().reportError(error);
    }
  },

  // Every change to a conversation is saved as it happens, so closing the app loses nothing but
  // the live log of a run in flight.
  setThread: (id, update) => {
    const thread = update(get().threads[id] ?? emptyThread());
    set((state) => ({ threads: { ...state.threads, [id]: thread } }));
    saveThread(id, thread).catch(get().reportError);
  },

  choose: (step, choice) => {
    save(`choice.${step}`, choice);
    set((state) => ({ choices: { ...state.choices, [step]: choice } }));
  },

  setMode: (mode) => {
    save("mode", mode);
    set({ mode });
  },

  setAutoCode: (on) => {
    save("autoCode", on);
    set({ autoCode: on });
  },

  onProgress: (event) => {
    // What a run reports about its conversation lands on the thread that holds that run.
    const onRun = (update: (thread: Thread) => Thread) => {
      for (const [id, thread] of Object.entries(get().threads)) if (update(thread) !== thread) get().setThread(id, update);
    };
    if (event.kind === "session") return onRun((t) => withRunSession(t, event.runId, event.value));
    if (event.kind === "changes") {
      const changes = readChanges(event.value);
      if (changes) onRun((t) => withRunChanges(t, event.runId, changes));
      return;
    }
    if (event.kind === "approval") {
      const question = readQuestion(event.value);
      if (!question) return;
      set((state) => ({ approvals: { ...state.approvals, [event.runId]: [...(state.approvals[event.runId] ?? []), question] } }));
      announce(`Needs your OK: Claude ${asking(question)} ${question.detail}`.trim(), "assertive");
      if (typeof document !== "undefined" && !document.hasFocus()) notify("dhrive needs your OK", `Claude ${asking(question)} ${question.detail}`.trim()).catch(() => undefined);
      return;
    }
    // What a run is doing right now goes to its own store, gathered into one update per beat (live.ts).
    if (event.kind === "edit") {
      const edit = readEdit(event.value);
      if (edit) pushLive({ runId: event.runId, kind: "edit", edit });
      return;
    }
    pushLive({ runId: event.runId, kind: event.kind === "phase" ? "phase" : "log", value: event.value });
  },

  reportError: (error) => set({ error: message(error) }),
  clearError: () => set({ error: null }),
  setUpdateReady: (version) => set({ updateReady: version }),
}));

// What a step's model is called on screen, in the words its CLI used for it.
export const useModelName = (engine: Engine | undefined, model: string) => useApp((s) => modelName(model, engine ? s.models[engine] : undefined));
