import { allowInProject, answerApproval, notify, runStep, stopRun, undoChanges, type Attachment, type Question, type Step, type StepResult } from "@/lib/api";
import { stagesFor } from "@/lib/flow";
import { reportsDetails } from "@/lib/names";
import { outcome } from "@/lib/outcome";
import { activeRun, approved, newRequest, nextUp, queuedIds, sessionFor, toReview, updateStage, withoutRequest, withSession, type RunMessage } from "@/lib/thread";
import { useApp } from "./app";
import { compactionOf, useContextUsage } from "./context";
import { announce } from "./announce";
import { folderOf, projectOf, useConversations } from "./conversations";
import { editing, inFolder } from "./editing";
import { useFiles } from "./files";
import { dropLive, setPhase } from "./live";
import { usePreview } from "./preview";

// Turning a request into CLI runs: a chat reply, or plan (in relay mode) then code carrying the
// plan, each resuming its CLI's session when the conversation keeps context. One run at a time per
// conversation, and conversations run side by side, except that code steps in the same project
// take turns: two at once would edit the same files, and each step's changes (and its undo) are
// what the tree looks like after it against before, which would mix the two.

const newId = () => crypto.randomUUID();
const WAITING = "Waiting for other work in this project to finish";


function stageOf(conversationId: string, messageId: string, step: Step) {
  const message = useApp.getState().threads[conversationId]?.messages.find((m): m is RunMessage => m.id === messageId && m.role === "run");
  return message?.[step] ?? null;
}

// Whether the stage still runs as this run: not stopped, not retried under another id meanwhile.
function stillOurs(conversationId: string, messageId: string, step: Step, runId: string) {
  const now = stageOf(conversationId, messageId, step);
  return now?.status === "running" && now.runId === runId;
}

async function runStage(conversationId: string, message: RunMessage, step: Step): Promise<StepResult | null> {
  const { threads, setThread } = useApp.getState();
  const folder = folderOf(conversationId);
  const stage = message[step];
  if (!folder || !stage) return null;
  const runId = newId();
  const resume = sessionFor(threads[conversationId], stage.engine);
  setThread(conversationId, (t) => updateStage(t, message.id, step, { status: "running", runId, startedAt: Date.now(), resumed: Boolean(resume) }));
  const plan = step === "code" ? stageOf(conversationId, message.id, "plan")?.output : undefined;
  let release = () => {};
  try {
    if (step === "code" && !message.chat) {
      if (editing.busy(folder)) setPhase(runId, WAITING);
      release = await editing.take(folder);
      // Stopped while it waited: it never started, so there's nothing to run or undo.
      if (stageOf(conversationId, message.id, step)?.status === "stopped") return null;
    }
    // A compaction the owner started on this session ends first; both at once would fight over it.
    if (resume) await compactionOf(stage.engine, resume);
    // Stopped while it waited for the compaction: it never starts.
    if (!stillOurs(conversationId, message.id, step, runId)) return null;
    const wire = message.chat ? "chat" : step;
    const instructions = threads[conversationId]?.instructions;
    const result = await runStep({ runId, folder, step: wire, engine: stage.engine, model: stage.model, effort: stage.effort, task: message.task, plan, resume, attachments: message.attachments, instructions });
    // A result that lands after the owner stopped the stage (or retried it) is dropped: "stopped"
    // never turns into "done", and nothing carries on from it.
    if (!stillOurs(conversationId, message.id, step, runId)) return null;
    setThread(conversationId, (t) =>
      withSession(updateStage(t, message.id, step, { status: "done", output: result.output, usage: result.usage, blocked: result.blocked?.length ? result.blocked : undefined, endedAt: Date.now() }), stage.engine, result.sessionId),
    );
    tellEnded(conversationId, step, message.chat, "done");
    return result;
  } catch (error) {
    if (stageOf(conversationId, message.id, step)?.status === "stopped") return null;
    setThread(conversationId, (t) => updateStage(t, message.id, step, { status: "failed", error: String(error), endedAt: Date.now() }));
    tellEnded(conversationId, step, message.chat, "failed");
    return null;
  } finally {
    release();
    dropLive(runId);
    // A code step may have added or removed files, which mentions should know about, and changed
    // what the project's dev server shows.
    if (step === "code") {
      void useFiles.getState().load(folder);
      usePreview.getState().reload(folder);
    }
    const session = sessionFor(useApp.getState().threads[conversationId], stage.engine);
    if (session && reportsDetails(stage.engine)) void useContextUsage.getState().read({ engine: stage.engine, session, folder, model: stage.model });
    useApp.setState((state) => ({ approvals: Object.fromEntries(Object.entries(state.approvals).filter(([id]) => id !== runId)) }));
  }
}

// For a screen reader: which step ended, and in which project.
function tellEnded(conversationId: string, step: Step, chat: boolean | undefined, how: "done" | "failed") {
  const name = useApp.getState().projects.find((p) => p.id === projectOf(conversationId))?.name;
  const what = chat ? "Reply" : step === "plan" ? "Plan" : "Code";
  announce(`${what} ${how === "failed" ? "failed" : chat ? "ready" : "done"}${name ? ` in ${name}` : ""}`);
}

// A plan that is really questions holds the code: the owner's reply is the next request, and it
// reaches the planner in the same session. A finished plan waits for the owner's OK before any code
// runs, unless they chose to skip that; the queue goes on meanwhile.
async function carryOut(conversationId: string, message: RunMessage, from: Step) {
  if (from === "plan" && message.plan) {
    const planned = await runStage(conversationId, message, "plan");
    const { setThread, autoCode } = useApp.getState();
    if (!planned || planned.needsAnswers) {
      setThread(conversationId, (t) => updateStage(t, message.id, "code", { status: planned ? "held" : "skipped" }));
      return;
    }
    if (!autoCode) return setThread(conversationId, (t) => toReview(t, message.id));
  }
  await runStage(conversationId, message, "code");
}

// One loop per conversation carries out whatever is next until nothing is waiting, so a request
// sent while another runs simply waits its turn.
const draining = new Set<string>();

async function drain(conversationId: string) {
  if (draining.has(conversationId)) return;
  draining.add(conversationId);
  try {
    for (let next = nextUp(useApp.getState().threads[conversationId]); next; next = nextUp(useApp.getState().threads[conversationId])) {
      await carryOut(conversationId, next.message, next.step);
      try {
        tell(conversationId, next.message.id);
      } catch {
        // A notification that can't be shown must never stop the queue.
      }
    }
  } finally {
    draining.delete(conversationId);
  }
}

export type Answer = "once" | "always" | "deny";

// The owner's answer to a tool call Claude asked about. "Always" also keeps the rule in the project,
// so the next runs don't ask again.
export async function answer(projectId: string | undefined, runId: string, question: Question, choice: Answer) {
  const { reportError } = useApp.getState();
  useApp.setState((state) => ({ approvals: { ...state.approvals, [runId]: (state.approvals[runId] ?? []).filter((q) => q.id !== question.id) } }));
  try {
    await answerApproval(question.id, choice !== "deny", choice === "always");
    if (choice === "always" && question.rule && projectId) {
      const project = await allowInProject(projectId, question.rule);
      useApp.setState((state) => ({ projects: state.projects.map((p) => (p.id === project.id ? project : p)) }));
    }
  } catch (error) {
    reportError(error);
  }
}

// A request that ended while the owner was in another window gets a notification: always when it
// needs them, and when it's done only if nothing else is queued behind it.
function tell(conversationId: string, messageId: string) {
  const thread = useApp.getState().threads[conversationId];
  const message = thread?.messages.find((m): m is RunMessage => m.id === messageId && m.role === "run");
  const ended = message && outcome(message);
  if (!ended || document.hasFocus() || (!ended.needsYou && nextUp(thread))) return;
  const title = useConversations.getState().conversations.find((c) => c.id === conversationId)?.title ?? "dhrive";
  notify(title, ended.text).catch(() => undefined);
}

export async function send(conversationId: string, task: string, attachments: Attachment[] = []) {
  const { choices, mode, setThread } = useApp.getState();
  const { plan, main } = stagesFor(mode, choices);
  if (!task.trim() || !main) return;
  const [user, run] = newRequest(task.trim(), plan, main, Date.now(), newId, mode === "chat", attachments);
  setThread(conversationId, (t) => ({ ...t, messages: [...t.messages, user, run] }));
  useConversations.getState().touch(conversationId);
  await drain(conversationId);
}

// The owner's OK on a plan in review, with their edits if they made any. Its code runs next, or when
// what's running in the conversation ends.
export async function approvePlan(conversationId: string, messageId: string, plan?: string) {
  const { threads, setThread } = useApp.getState();
  const thread = threads[conversationId];
  if (!thread || approved(thread, messageId, plan) === thread) return;
  setThread(conversationId, (t) => approved(t, messageId, plan));
  await drain(conversationId);
}

// Takes back a request that is still waiting its turn.
export function cancelQueued(conversationId: string, messageId: string) {
  const { threads, setThread } = useApp.getState();
  if (queuedIds(threads[conversationId]).has(messageId)) setThread(conversationId, (t) => withoutRequest(t, messageId));
}

// Runs a failed, stopped or interrupted stage again, with the CLI and model it had.
export async function retry(conversationId: string, messageId: string, step: Step) {
  const { threads, setThread } = useApp.getState();
  if (activeRun(threads[conversationId])) return;
  setThread(conversationId, (t) => {
    const next = updateStage(t, messageId, step, { status: "waiting", error: null, output: "" });
    return step === "plan" ? updateStage(next, messageId, "code", { status: "waiting", error: null, output: "" }) : next;
  });
  await drain(conversationId);
}

export function stop(conversationId: string) {
  const { threads, setThread, reportError } = useApp.getState();
  const running = activeRun(threads[conversationId]);
  if (!running) return;
  const { message, step } = running;
  const runId = message[step]?.runId;
  setThread(conversationId, (t) => {
    const stopped = updateStage(t, message.id, step, { status: "stopped", endedAt: Date.now() });
    return step === "plan" ? updateStage(stopped, message.id, "code", { status: "skipped" }) : stopped;
  });
  if (runId) stopRun(runId).catch(reportError);
}

export function setKeepContext(conversationId: string, on: boolean) {
  useApp.getState().setThread(conversationId, (t) => ({ ...t, keepContext: on }));
}

// Puts back what a finished code step changed. Nothing else may be running in the conversation, since
// a run in flight could be editing the same files.
// Undos in flight, by step: a second click while one runs would restore twice, the second against
// what the first just put back.
const undoing = new Set<string>();

export async function undoRun(conversationId: string, messageId: string) {
  const { threads, setThread, reportError } = useApp.getState();
  const thread = threads[conversationId];
  const stage = stageOf(conversationId, messageId, "code");
  const folder = folderOf(conversationId);
  if (!thread || !stage?.changes || stage.undone || !folder || activeRun(thread) || undoing.has(messageId)) return;
  const changes = stage.changes;
  undoing.add(messageId);
  try {
    const undone = await inFolder(folder, () => undoChanges(folder, changes));
    setThread(conversationId, (t) => updateStage(t, messageId, "code", { undone }));
    void useFiles.getState().load(folder);
  } catch (error) {
    reportError(error);
  } finally {
    undoing.delete(messageId);
  }
}
