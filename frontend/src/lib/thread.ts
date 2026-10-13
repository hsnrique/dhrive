import type { Attachment, Changes, Engine, Step, Undo, Usage } from "@/lib/api";
import type { Choice } from "@/lib/flow";

// A conversation as dhrive stores it: the owner's requests, and for each one a run with its plan
// and code stages. Sessions hold the CLI conversation to resume, per CLI.

// "held" is a code stage waiting on the owner's answers to the planner's questions, "review" one
// waiting for the owner to approve the plan above it, and "declined" one whose plan a newer plan in
// the conversation replaced before it was approved.
export type StageStatus = "waiting" | "running" | "done" | "failed" | "stopped" | "skipped" | "interrupted" | "held" | "review" | "declined";

export interface Stage {
  engine: Engine;
  model: string;
  effort?: string;
  status: StageStatus;
  output: string;
  error: string | null;
  usage: Usage | null;
  runId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  resumed: boolean;
  // What a code step changed in the project, when it's a git repo, and what undoing it did.
  changes?: Changes | null;
  undone?: Undo | null;
  blocked?: string[];
  // The owner changed this plan before approving it; the coder got their version.
  edited?: boolean;
  // A code step's files the owner committed from dhrive, and the pull request opened for them.
  committed?: { sha: string; branch: string | null; pr?: string };
}

export interface UserMessage {
  id: string;
  role: "user";
  text: string;
  at: number;
  attachments?: Attachment[];
}

// A chat is a run whose single stage sits in the code slot, the one every run has; `chat` marks it
// so it runs read-only with the chat brief and is labeled Chat.
export interface RunMessage {
  id: string;
  role: "run";
  task: string;
  plan: Stage | null;
  code: Stage;
  chat?: boolean;
  // Absolute paths of the files attached to the request, handed to every stage.
  attachments?: string[];
}

export type Message = UserMessage | RunMessage;

export interface Thread {
  messages: Message[];
  sessions: Partial<Record<Engine, string>>;
  keepContext?: boolean;
  // What the owner wants this conversation's agents to follow, on top of the instructions for every
  // project.
  instructions?: string;
}

export const emptyThread = (): Thread => ({ messages: [], sessions: {}, keepContext: true });

export const keepsContext = (thread: Thread) => thread.keepContext !== false;

function waiting(choice: Choice): Stage {
  return { ...choice, status: "waiting", output: "", error: null, usage: null, runId: null, startedAt: null, endedAt: null, resumed: false };
}

export function newRequest(task: string, plan: Choice | null, code: Choice, now: number, makeId: () => string, chat = false, attachments: Attachment[] = []): [UserMessage, RunMessage] {
  const files = attachments.length ? { attachments: attachments.map((a) => a.path) } : {};
  const run: RunMessage = { id: makeId(), role: "run", task, plan: plan && waiting(plan), code: waiting(code), ...files };
  const user: UserMessage = { id: makeId(), role: "user", text: task, at: now, ...(attachments.length ? { attachments } : {}) };
  return [user, chat ? { ...run, plan: null, chat: true } : run];
}

export function updateStage(thread: Thread, messageId: string, step: Step, changes: Partial<Stage>): Thread {
  const messages = thread.messages.map((message) => {
    if (message.id !== messageId || message.role !== "run") return message;
    const stage = message[step];
    return stage ? { ...message, [step]: { ...stage, ...changes } } : message;
  });
  return { ...thread, messages };
}

const LIVE: StageStatus[] = ["waiting", "running"];

// A stage still "running" in a saved thread means the app closed under it; say so rather than
// pretend it is still going.
export function interruptStale(thread: Thread): Thread {
  const settle = (stage: Stage | null) => (stage && LIVE.includes(stage.status) ? { ...stage, status: "interrupted" as const } : stage);
  return {
    ...thread,
    messages: thread.messages.map((m) => (m.role === "run" ? { ...m, plan: settle(m.plan), code: settle(m.code)! } : m)),
  };
}

export function activeRun(thread: Thread | undefined): { message: RunMessage; step: Step } | null {
  for (const message of thread?.messages ?? []) {
    if (message.role !== "run") continue;
    for (const step of ["plan", "code"] as const) {
      const stage = message[step];
      if (stage && LIVE.includes(stage.status)) return { message, step };
    }
  }
  return null;
}

// What should run next in a conversation: the first stage still waiting, unless one is running.
// Requests sent while another runs wait their turn this way, in the order they were sent.
export function nextUp(thread: Thread | undefined): { message: RunMessage; step: Step } | null {
  for (const message of thread?.messages ?? []) {
    if (message.role !== "run") continue;
    const stages = (["plan", "code"] as const).filter((step) => message[step]);
    if (stages.some((step) => message[step]!.status === "running")) return null;
    const waiting = stages.find((step) => message[step]!.status === "waiting");
    if (waiting) return { message, step: waiting };
  }
  return null;
}

// The plan is done and its code waits for the owner's OK. A newer plan replaces any older one still
// waiting, so only the latest plan in a conversation can be approved.
export function toReview(thread: Thread, messageId: string): Thread {
  const messages = thread.messages.map((m) => {
    if (m.role !== "run") return m;
    if (m.id === messageId) return { ...m, code: { ...m.code, status: "review" as const } };
    return m.code.status === "review" ? { ...m, code: { ...m.code, status: "declined" as const } } : m;
  });
  return { ...thread, messages };
}

// The owner approved the plan, as they edited it if they did; its code then waits its turn to run.
// Anything but a plan still in review is left as it is.
export function approved(thread: Thread, messageId: string, plan?: string): Thread {
  const message = thread.messages.find((m): m is RunMessage => m.id === messageId && m.role === "run");
  if (message?.code.status !== "review") return thread;
  const next = updateStage(thread, messageId, "code", { status: "waiting" });
  const edit = plan?.trim();
  if (!edit || !message.plan || edit === message.plan.output.trim()) return next;
  return updateStage(next, messageId, "plan", { output: edit, edited: true });
}

export const awaitingReview = (thread: Thread | undefined) => thread?.messages.some((m) => m.role === "run" && m.code.status === "review") ?? false;

// Requests sent while an earlier one was still going; none of their stages has started.
export function queuedIds(thread: Thread | undefined): Set<string> {
  const ids = new Set<string>();
  let busy = false;
  for (const message of thread?.messages ?? []) {
    if (message.role !== "run") continue;
    const stages = [message.plan, message.code].filter((stage): stage is Stage => stage !== null);
    if (busy && stages.every((stage) => stage.status === "waiting")) ids.add(message.id);
    busy ||= stages.some((stage) => LIVE.includes(stage.status));
  }
  return ids;
}

// A queued request goes with the owner's message that asked for it.
export function withoutRequest(thread: Thread, runId: string): Thread {
  const at = thread.messages.findIndex((m) => m.id === runId && m.role === "run");
  if (at < 0) return thread;
  const from = at > 0 && thread.messages[at - 1].role === "user" ? at - 1 : at;
  return { ...thread, messages: [...thread.messages.slice(0, from), ...thread.messages.slice(at + 1)] };
}

// The run id of what's running in a conversation, if anything is.
export function runningId(thread: Thread | undefined): string | null {
  const run = activeRun(thread);
  return run?.message[run.step]?.runId ?? null;
}

export function withSession(thread: Thread, engine: Engine, sessionId: string | null): Thread {
  if (!sessionId || !keepsContext(thread) || thread.sessions[engine] === sessionId) return thread;
  return { ...thread, sessions: { ...thread.sessions, [engine]: sessionId } };
}

// A CLI names its session as a run starts. Keeping it then, not when the run returns, means a run
// that fails, is stopped, or is cut off by closing the app still leaves its conversation to continue.
export function withRunSession(thread: Thread, runId: string, sessionId: string): Thread {
  const run = findRun(thread, runId);
  return run ? withSession(thread, run.stage.engine, sessionId) : thread;
}

export function withRunChanges(thread: Thread, runId: string, changes: Changes): Thread {
  const run = findRun(thread, runId);
  return run ? updateStage(thread, run.messageId, run.step, { changes }) : thread;
}

function findRun(thread: Thread, runId: string): { messageId: string; step: Step; stage: Stage } | null {
  for (const message of thread.messages) {
    if (message.role !== "run") continue;
    for (const step of ["plan", "code"] as const) {
      const stage = message[step];
      if (stage?.runId === runId) return { messageId: message.id, step, stage };
    }
  }
  return null;
}

export function sessionFor(thread: Thread, engine: Engine): string | undefined {
  return keepsContext(thread) ? thread.sessions[engine] : undefined;
}
