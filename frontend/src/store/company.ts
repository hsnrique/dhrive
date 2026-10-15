import { create } from "zustand";

import { readCompany, readCompanyRecord, runStep, saveCompany, saveCompanyRecord, stopRun } from "@/lib/api";
import { EMPTY_BRIEF, fromMarkdown, parseDraft, toMarkdown, withDraft, type Brief, type Section } from "@/lib/company";
import { savedEffort, type Choice } from "@/lib/flow";
import { readSaved, save } from "@/lib/storage";
import { useApp } from "./app";
import { useConversations } from "./conversations";

// Each project run as a company: its brief, read from and saved to the project's COMPANY.md as the
// owner types, and drafted from the project by a CLI that only reads. The company page is a page
// like a conversation: opening it takes the focus off any conversation.

const CHOICE_KEY = "company.choice";
const SAVE_AFTER_MS = 500;
const NOTHING = "The CLI didn't return a brief. Try again, or write the first lines yourself.";
const ASK = "Write the brief from what this project says about itself.";

export type Saving = "saved" | "saving" | "failed";

export interface Company {
  // Null until COMPANY.md has been read.
  brief: Brief | null;
  saving: Saving;
  // The draft in flight, whose progress is in the app's live log under this id.
  runId: string | null;
  error: string | null;
  // Why COMPANY.md couldn't be read, while it can't: nothing writes the brief meanwhile, since what's
  // in memory isn't what's in the owner's file.
  unreadable?: string | null;
}

const IDLE: Company = { brief: null, saving: "saved", runId: null, error: null, unreadable: null };

interface CompanyState {
  openId: string | null;
  byProject: Record<string, Company>;
  // The agent (CLI and model) a new company starts with, picked where companies are founded. Unset
  // until the owner picks one; companyAgent() says who it is meanwhile.
  choice: Choice | null;
  // Each company's own agent, kept in its .company/agent record: who drafts its brief, plans and
  // works its days and answers its chat. A company without one works with `choice`.
  agents: Record<string, Choice>;
  open: (projectId: string) => void;
  load: (projectId: string) => Promise<void>;
  change: (projectId: string, section: Section, text: string) => void;
  // For one company, or, without one, the agent new companies start with.
  choose: (choice: Choice, projectId?: string) => void;
  draft: (projectId: string) => Promise<void>;
  stop: (projectId: string) => void;
}

const asChoice = (value: unknown): Choice | null => {
  const choice = value as Partial<Choice> | null;
  return typeof choice?.engine === "string" && typeof choice.model === "string" ? { engine: choice.engine, model: choice.model, ...savedEffort(choice.effort) } : null;
};

// The saved choice holds only while its CLI is still installed.
const usableChoice = (choice: Choice | null) => (choice && useApp.getState().clis.some((cli) => cli.installed && cli.engine === choice.engine) ? choice : null);

const nameOf = (projectId: string) => useApp.getState().projects.find((p) => p.id === projectId)?.name ?? "Company";

export const useCompany = create<CompanyState>((set, get) => {
  const company = (projectId: string) => get().byProject[projectId] ?? IDLE;
  const patch = (projectId: string, change: Partial<Company>) => set((s) => ({ byProject: { ...s.byProject, [projectId]: { ...IDLE, ...s.byProject[projectId], ...change } } }));
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const write = async (projectId: string) => {
    const { brief, unreadable } = company(projectId);
    if (!brief || unreadable) return;
    try {
      await saveCompany(projectId, toMarkdown(brief, nameOf(projectId)));
      patch(projectId, { saving: "saved" });
    } catch {
      patch(projectId, { saving: "failed" });
    }
  };
  // Read once per company; a pick made meanwhile isn't replaced by what's on disk.
  const loadAgent = async (projectId: string) => {
    if (get().agents[projectId]) return;
    try {
      const saved = asChoice(await readCompanyRecord(projectId, "agent"));
      if (saved && !get().agents[projectId]) set((s) => ({ agents: { ...s.agents, [projectId]: saved } }));
    } catch {
      // No record yet, or none to read: the company works with the default.
    }
  };
  const saveSoon = (projectId: string) => {
    patch(projectId, { saving: "saving" });
    clearTimeout(timers.get(projectId));
    timers.set(projectId, setTimeout(() => void write(projectId), SAVE_AFTER_MS));
  };

  return {
    openId: null,
    byProject: {},
    choice: asChoice(readSaved(CHOICE_KEY)),
    agents: {},
    open: (projectId) => {
      set({ openId: projectId });
      useConversations.setState({ open: null });
      useApp.getState().openPage("company");
      void get().load(projectId);
    },
    load: async (projectId) => {
      void loadAgent(projectId);
      // A brief being typed or drafted isn't replaced by what's on disk.
      if (company(projectId).brief && (company(projectId).saving !== "saved" || company(projectId).runId)) return;
      try {
        patch(projectId, { brief: fromMarkdown(await readCompany(projectId)), unreadable: null });
      } catch (error) {
        // An empty brief here would be saved over the file at the first keystroke.
        patch(projectId, { unreadable: String(error) });
      }
    },
    change: (projectId, section, text) => {
      if (company(projectId).unreadable) return;
      patch(projectId, { brief: { ...(company(projectId).brief ?? EMPTY_BRIEF), [section]: text } });
      saveSoon(projectId);
    },
    choose: (choice, projectId) => {
      if (!projectId) {
        save(CHOICE_KEY, choice);
        set({ choice });
        return;
      }
      set((s) => ({ agents: { ...s.agents, [projectId]: choice } }));
      void saveCompanyRecord(projectId, "agent", choice).catch(() => undefined);
    },
    draft: async (projectId) => {
      const folder = useApp.getState().projects.find((p) => p.id === projectId)?.folder;
      const choice = companyAgent(projectId);
      if (!folder || !choice || company(projectId).runId || company(projectId).unreadable) return;
      const runId = crypto.randomUUID();
      patch(projectId, { runId, error: null });
      try {
        const result = await runStep({ runId, folder, step: "company", engine: choice.engine, model: choice.model, effort: choice.effort, task: ASK });
        if (company(projectId).runId !== runId) return;
        const drafted = parseDraft(result.output);
        const found = Object.keys(drafted).length > 0;
        patch(projectId, { runId: null, error: found ? null : NOTHING, brief: withDraft(company(projectId).brief ?? EMPTY_BRIEF, drafted) });
        if (found) saveSoon(projectId);
      } catch (error) {
        if (company(projectId).runId === runId) patch(projectId, { runId: null, error: String(error) });
      }
    },
    stop: (projectId) => {
      const { runId } = company(projectId);
      if (!runId) return;
      patch(projectId, { runId: null });
      void stopRun(runId);
    },
  };
});

// Who works for a company: its own pick, else the one new companies start with, while its CLI is
// installed; else the owner's coder.
export const companyAgent = (projectId?: string): Choice | null => {
  const { agents, choice } = useCompany.getState();
  return usableChoice((projectId && agents[projectId]) || null) ?? usableChoice(choice) ?? useApp.getState().choices.code ?? useApp.getState().choices.plan;
};

// What a company's screen re-renders on: its own agent and the default.
export const useAgentOf = (projectId: string) => useCompany((s) => s.agents[projectId] ?? s.choice);

export const useCompanyOf = (projectId: string) => useCompany((s) => s.byProject[projectId] ?? IDLE);
