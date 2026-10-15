import { armyChanges, armyDiscard, armyLand, armyPrepare, armySync, runChecks, runStep, type CheckReport, type StepResult } from "@/lib/api";
import { agentById, conflictPrompt } from "@/lib/army";
import { FIX_ATTEMPTS, failure, fixPrompt, passed, verdict } from "@/lib/checks";
import { clipped, handoffs, taskPrompt, type Task } from "@/lib/day";
import { addSpend, type SpentOn } from "@/lib/spend";
import { entry } from "@/lib/log";
import { outside, parseReview, reviewFixPrompt, reviewPrompt, territoryPrompt } from "@/lib/review";
import { useApp } from "./app";
import { useArmy } from "./army";
import { inFolder } from "./editing";
import { dropLive } from "./live";
import { companyAgent } from "./company";
import type { Day } from "./day";
import { useGitHub } from "./github";
import { useLog } from "./log";

// How one of a company's tasks runs (the day store decides which and when): the task, then dhrive's
// own checks of what it delivered (checks.rs). What fails goes back to the same conversation, up to
// FIX_ATTEMPTS times; only a delivery that passes is done. Every run (the task, the checks, a fix)
// takes a fresh id, so a stop or a retry, which change the task's, end it. An army's task works in a
// copy of its own and lands in line with the others.

interface Deps {
  day: (projectId: string) => Day;
  patchTask: (projectId: string, id: string, change: Partial<Task>) => void;
}

const projectOf = (projectId: string) => useApp.getState().projects.find((p) => p.id === projectId);

// The company's own folder (an army task's copy lives inside it).
const copyOwner = (projectId: string) => projectOf(projectId)?.folder ?? projectId;

// Thrown when a step would start for a run the owner stopped (or retried) during the await before it.
class Stopped extends Error {}
const armyOf = (projectId: string) => useArmy.getState().byProject[projectId] ?? [];

export function taskRunner({ day, patchTask }: Deps) {
  const finish = (projectId: string, task: Task, status: "done" | "failed", text: string) => {
    patchTask(projectId, task.id, { status, runId: null, result: clipped(text) });
    useLog.getState().add(projectId, entry(status, task.title, { taskId: task.id }));
  };

  // One run of a task: a fresh id for every step (the task, the checks, a fix), so a stop or a
  // retry, which change the task's, end it; `ours` says whether this run is still the task's.
  const begin = (projectId: string, task: Task, folder: string) => {
    let runId = "";
    const now = () => day(projectId).tasks.find((t) => t.id === task.id);
    const ours = () => now()?.runId === runId;
    // Every step starts here, so this is where a stop pressed during any await (an army's copy being
    // made, its changes being read, a sync) takes hold: a stopped task never starts its next step and
    // never comes back to "running". Before its first step it must still be up next, or picked.
    const fresh = () => {
      const current = now();
      const live = runId ? current?.runId === runId : current?.status === "planned" || current?.status === "running";
      if (!live) throw new Stopped("Stopped.");
      if (runId) dropLive(runId);
      runId = crypto.randomUUID();
      patchTask(projectId, task.id, { status: "running", runId });
      return runId;
    };
    // Every run's tokens go on the task, by what it was doing, even when the run was stopped meanwhile:
    // they were spent all the same.
    const spend = (on: SpentOn, result: StepResult) => {
      const now = day(projectId).tasks.find((t) => t.id === task.id);
      if (now) patchTask(projectId, task.id, { spent: addSpend(now.spent, on, result.usage) });
      return result;
    };
    const code = async (on: SpentOn, prompt: string, resume: string | null, where = folder) => {
      const { ask, mcp } = day(projectId);
      return spend(on, await runStep({ runId: fresh(), folder: where, step: "code", engine: task.engine, model: task.model, effort: task.effort, task: prompt, resume: resume ?? undefined, unattended: !ask, mcp }));
    };
    // dhrive's checks in `copy` (an army task's) or the folder; what fails goes back to the same
    // conversation, up to FIX_ATTEMPTS times.
    const checked = async (result: StepResult, copy?: string): Promise<{ result: StepResult; report: CheckReport } | null> => {
      for (let fixes = 0; ; fixes++) {
        const report = await runChecks(projectId, fresh(), copy && task.id);
        if (!ours()) return null;
        if (passed(report) || fixes === FIX_ATTEMPTS) return { result: { ...result, output: result.output + (passed(report) ? verdict(report, fixes) : "") }, report };
        result = await code("fix", fixPrompt(report, task.title), result.sessionId, copy);
      }
    };
    const settle = () => runId && dropLive(runId);
    return { projectId, task, fresh, ours, spend, code, checked, settle };
  };
  type Run = ReturnType<typeof begin>;

  // An army task that doesn't pass keeps its work on its branch, never in the company's folder.
  const fail = async (run: Run, why: string) => {
    await armyDiscard(run.projectId, run.task.id, run.task.title);
    finish(run.projectId, run.task, "failed", why);
    return null;
  };

  // Something asked of the agent before it lands, then the checks again: what it delivered then, or
  // null once it was stopped or failed (and finished as failed).
  const amend = async (run: Run, on: SpentOn, copy: string, ask: string, result: StepResult) => {
    const back = await run.checked(await run.code(on, ask, result.sessionId, copy), copy);
    if (!back || !run.ours()) return null;
    return passed(back.report) ? back.result : fail(run, failure(back.report));
  };

  // Its territory: files it changed outside the folders its agent owns go back to it, once.
  const territory = async (run: Run, copy: string, result: StepResult) => {
    const agent = agentById(armyOf(run.projectId), run.task.agentId);
    if (!agent?.owns) return result;
    const strays = async () => outside((await armyChanges(run.projectId, run.task.id, run.task.title)).files, agent.owns ?? "");
    const out = await strays();
    if (!out.length) return result;
    const back = await amend(run, "territory", copy, territoryPrompt(out, agent.owns), result);
    if (!back) return null;
    const still = await strays();
    return still.length ? fail(run, `It changed files outside what ${agent.name} owns: ${still.join(", ")}`) : back;
  };

  // A review by the company's own agent, when the company asks for one: what it finds goes back once.
  const review = async (run: Run, copy: string, result: StepResult) => {
    const reviewer = companyAgent(run.projectId);
    if (!day(run.projectId).review || !reviewer) return result;
    const { diff } = await armyChanges(run.projectId, run.task.id, run.task.title);
    const said = run.spend("review", await runStep({ runId: run.fresh(), folder: copy, step: "chat", engine: reviewer.engine, model: reviewer.model, effort: reviewer.effort, task: reviewPrompt(run.task.title, run.task.prompt, diff) }));
    if (!run.ours()) return null;
    const found = parseReview(said.output);
    return found.approve ? result : amend(run, "review", copy, reviewFixPrompt(found.issues), result);
  };

  // In line with the others: the company's latest merged in (its agent resolving any conflict),
  // checked once more, merged back into the folder, backed up.
  const land = (run: Run, copy: string, done: StepResult) =>
    inLine(run.projectId, async () => {
      if (!run.ours()) return;
      let result = done;
      let synced = await armySync(run.projectId, run.task.id, run.task.title);
      if (synced.kind === "conflicts") {
        result = await run.code("conflict", conflictPrompt(synced.files), result.sessionId, copy);
        if (!run.ours()) return;
        synced = await armySync(run.projectId, run.task.id, run.task.title);
        if (synced.kind === "conflicts") throw new Error(`It couldn't merge with the company's latest work: ${synced.files.join(", ")}`);
      }
      const report = await runChecks(run.projectId, run.fresh(), run.task.id);
      if (!run.ours()) return;
      if (!passed(report)) return void (await fail(run, failure(report)));
      // Merging back writes the company's folder, so it takes the folder like any writer.
      await inFolder(copyOwner(run.projectId), () => armyLand(run.projectId, run.task.id, run.task.title));
      finish(run.projectId, run.task, "done", result.output);
      await useGitHub.getState().backup(run.projectId);
    });

  // An army's task works in its own copy, passes its checks there, its territory and a review if
  // asked, then lands in line with the others.
  const asArmy = async (run: Run, prompt: string) => {
    const copy = await armyPrepare(run.projectId, run.task.id);
    const first = await run.checked(await run.code("task", prompt, null, copy), copy);
    if (!first) return;
    if (!passed(first.report)) return void (await fail(run, failure(first.report)));
    const kept = await territory(run, copy, first.result);
    const reviewed = kept && (await review(run, copy, kept));
    if (reviewed) await land(run, copy, reviewed);
  };

  // A task on its own: in the company's folder, done once its checks pass. It holds the folder from
  // its first edit to its last check, so a conversation's code step never runs in the middle of it.
  const alone = async (run: Run, prompt: string) => {
    const done = await inFolder(copyOwner(run.projectId), async () => run.checked(await run.code("task", prompt, null)));
    if (done) finish(run.projectId, run.task, passed(done.report) ? "done" : "failed", passed(done.report) ? done.result.output : failure(done.report));
  };

  const runTask = async (projectId: string, task: Task, army = false) => {
    const project = projectOf(projectId);
    // A company that's gone can't run anything; marked stopped, so no pass keeps picking it up.
    if (!project) return void patchTask(projectId, task.id, { status: "stopped", runId: null });
    const run = begin(projectId, task, project.folder);
    patchTask(projectId, task.id, { result: "" });
    const prompt = taskPrompt(task, project.name, agentById(armyOf(projectId), task.agentId), army ? handoffs(day(projectId).tasks, armyOf(projectId)) : "", day(projectId).lean);
    try {
      await (army ? asArmy(run, prompt) : alone(run, prompt));
    } catch (error) {
      if (error instanceof Stopped || !run.ours()) return;
      if (army) await armyDiscard(projectId, task.id, task.title).catch(() => undefined);
      finish(projectId, task, "failed", String(error));
    } finally {
      run.settle();
    }
  };

  // One landing at a time per company, so each merges onto the one before it.
  const landing = new Map<string, Promise<void>>();
  const inLine = (projectId: string, step: () => Promise<void>) => {
    const next = (landing.get(projectId) ?? Promise.resolve()).then(step);
    landing.set(projectId, next.catch(() => undefined));
    return next;
  };

  return { runTask };
}
