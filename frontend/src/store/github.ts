import { create } from "zustand";

import { githubSignIn, githubState, pendingChanges, runStep, saveToGithub, type GitHubState } from "@/lib/api";
import { commitMessage } from "@/lib/commit";
import { entry } from "@/lib/log";
import { useApp } from "./app";
import { companyAgent } from "./company";
import { useLog } from "./log";

// Each company's code on GitHub, through the owner's gh. Signing in is gh's own browser flow: its
// one-time code shows here while the owner approves on github.com. Saving commits what changed (never
// a secret) with the owner's message, or one the company's agent writes from the changes, and pushes
// it, making a private repo the first time; it goes in the company's timeline.
// Once the repo is there, each finished task is backed up the same way, quietly: the company's code,
// documents and records (.company/) never live only on this Mac.

export interface GitHub {
  state: GitHubState | null;
  saving: boolean;
  // The commit message the agent is writing, by its run id while it does.
  writing: string | null;
  error: string | null;
  backedUpAt: number | null;
}

export const UNKNOWN: GitHub = { state: null, saving: false, writing: null, error: null, backedUpAt: null };

interface GitHubStore {
  byProject: Record<string, GitHub>;
  // While gh's sign-in runs, and the code it gave once it has.
  signingIn: boolean;
  code: string | null;
  load: (projectId: string) => Promise<void>;
  signIn: (projectId: string) => Promise<void>;
  save: (projectId: string, message?: string) => Promise<void>;
  // The agent's message for what changed, or null when there's nothing to say or it couldn't.
  writeMessage: (projectId: string) => Promise<string | null>;
  backup: (projectId: string) => Promise<void>;
  onCode: (code: string) => void;
}

export const useGitHub = create<GitHubStore>((set, get) => {
  const of = (projectId: string) => get().byProject[projectId] ?? UNKNOWN;
  const patch = (projectId: string, change: Partial<GitHub>) => set({ byProject: { ...get().byProject, [projectId]: { ...of(projectId), ...change } } });
  return {
    byProject: {},
    signingIn: false,
    code: null,
    load: async (projectId) => {
      try {
        patch(projectId, { state: await githubState(projectId) });
      } catch (error) {
        patch(projectId, { error: String(error) });
      }
    },
    signIn: async (projectId) => {
      if (get().signingIn) return;
      set({ signingIn: true, code: null });
      patch(projectId, { error: null });
      try {
        await githubSignIn();
      } catch (error) {
        patch(projectId, { error: String(error) });
      } finally {
        set({ signingIn: false, code: null });
        await get().load(projectId);
      }
    },
    save: async (projectId, message) => {
      if (of(projectId).saving) return;
      const first = !of(projectId).state?.repo;
      patch(projectId, { saving: true, error: null });
      try {
        const repo = await saveToGithub(projectId, message);
        useLog.getState().add(projectId, entry("published", first ? `the code is on GitHub, private` : "the latest work is saved on GitHub", { url: repo }));
        patch(projectId, { saving: false });
      } catch (error) {
        patch(projectId, { saving: false, error: String(error) });
      }
      await get().load(projectId);
    },
    writeMessage: async (projectId) => {
      const project = useApp.getState().projects.find((p) => p.id === projectId);
      const agent = companyAgent(projectId);
      if (!project || !agent || of(projectId).writing) return null;
      const runId = crypto.randomUUID();
      patch(projectId, { writing: runId, error: null });
      try {
        const changes = await pendingChanges(projectId);
        if (!changes) return null;
        const result = await runStep({ runId, folder: project.folder, step: "commit", engine: agent.engine, model: agent.model, effort: agent.effort, task: changes });
        return commitMessage(result.output);
      } catch (error) {
        patch(projectId, { error: String(error) });
        return null;
      } finally {
        if (of(projectId).writing === runId) patch(projectId, { writing: null });
      }
    },
    // Never makes the repo, which is the owner's call; a failure shows on the button and never throws.
    backup: async (projectId) => {
      if (!of(projectId).state) await get().load(projectId);
      const { state, saving } = of(projectId);
      if (!state?.account || !state.repo || saving) return;
      patch(projectId, { saving: true, error: null });
      try {
        await saveToGithub(projectId);
        patch(projectId, { saving: false, backedUpAt: Date.now() });
      } catch (error) {
        patch(projectId, { saving: false, error: String(error) });
      }
      await get().load(projectId);
    },
    onCode: (code) => set({ code }),
  };
});

export const useGitHubOf = (projectId: string) => useGitHub((s) => s.byProject[projectId] ?? UNKNOWN);
