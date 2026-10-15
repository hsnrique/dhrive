import { create } from "zustand";

import { foundCompany, foundingDir, runStep, stopRun } from "@/lib/api";
import { EMPTY_BRIEF, toMarkdown, withDraft } from "@/lib/company";
import { FIRST_DELIVERY, parseFounding, surprise } from "@/lib/founding";
import { useApp } from "./app";
import { companyAgent, useCompany } from "./company";
import { useDay } from "./day";

// Starting a company, all the way, with no stop for an OK unless the owner turned Ask first on
// before starting: the owner's agent looks around briefly,
// names it and writes its brief (reading nothing of the owner's), the company gets a folder and a
// repo, and the agent plans its first delivery, the product and its website together, which starts
// working as the owner lands on its page. One at a time; each step's progress is in the app's live
// log under the step's run id.

export type Phase = "idle" | "naming" | "planning" | "failed";

const NO_NAME = "The CLI didn't found a company. Try again, or say a little more.";

interface FoundingState {
  phase: Phase;
  // What the owner asked for; empty when they asked to be surprised.
  idea: string;
  // Ask first, chosen on the founding screen: the first delivery's tasks wait for the owner's OK.
  ask: boolean;
  name: string;
  runId: string | null;
  projectId: string | null;
  error: string | null;
  start: (idea: string, ask: boolean) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

const IDLE = { phase: "idle" as Phase, idea: "", ask: false, name: "", runId: null, projectId: null, error: null };

export const useFounding = create<FoundingState>((set, get) => {
  // A stop (or a new start) makes every step still in flight stale.
  let attempt = 0;
  const step = async (mine: number, request: Parameters<typeof runStep>[0]) => {
    // Stopped while the folder was being made: the CLI never starts.
    if (mine !== attempt) throw new Error("stopped");
    set({ runId: request.runId });
    const result = await runStep(request);
    if (mine !== attempt) throw new Error("stopped");
    return result.output;
  };

  const name = async (mine: number, idea: string) => {
    const choice = companyAgent();
    if (!choice) throw new Error("Install Claude Code, Codex or Antigravity first.");
    const output = await step(mine, { runId: crypto.randomUUID(), folder: await foundingDir(), step: "found", engine: choice.engine, model: choice.model, effort: choice.effort, task: idea.trim() || surprise() });
    const founded = parseFounding(output);
    if (!founded) throw new Error(NO_NAME);
    const brief = withDraft({ ...EMPTY_BRIEF }, founded.draft);
    const project = await foundCompany(founded.name, toMarkdown(brief, founded.name));
    useApp.setState((s) => ({ projects: [project, ...s.projects.filter((p) => p.id !== project.id)] }));
    useCompany.getState().choose(choice, project.id);
    set({ name: founded.name, projectId: project.id });
    return project;
  };

  return {
    ...IDLE,
    start: async (idea, ask) => {
      if (get().phase !== "idle" && get().phase !== "failed") return;
      const mine = ++attempt;
      set({ ...IDLE, phase: "naming", idea, ask });
      try {
        const project = await name(mine, idea);
        // Each await is a moment the owner may have pressed Stop; past one, nothing more starts.
        if (mine !== attempt) return;
        set({ phase: "planning", runId: null });
        await useCompany.getState().load(project.id);
        if (mine !== attempt) return;
        useDay.getState().setAsk(project.id, ask);
        await useDay.getState().plan(project.id, FIRST_DELIVERY);
        if (mine !== attempt) return;
        set({ ...IDLE });
        useCompany.getState().open(project.id);
      } catch (error) {
        if (mine === attempt) set({ phase: "failed", runId: null, error: error instanceof Error ? error.message : String(error) });
      }
    },
    stop: () => {
      const { runId, projectId } = get();
      attempt++;
      set({ phase: "failed", runId: null, error: "Stopped." });
      if (runId) void stopRun(runId);
      if (projectId) useDay.getState().stopPlan(projectId);
    },
    reset: () => {
      attempt++;
      set({ ...IDLE });
    },
  };
});
