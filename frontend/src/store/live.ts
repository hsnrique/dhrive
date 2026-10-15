import { create } from "zustand";

import type { LiveEdit } from "@/lib/linediff";
import { appendLog } from "@/lib/flow";

// What each run is doing right now: its phase, the last lines it printed, the file edits it made.
// It changes many times a second while anything runs, so it lives apart from the app's store: here
// only what watches a run re-renders, and the backend's events land in one update per beat instead
// of one per event. A run's entry goes when the run settles; the cap is a backstop for any that
// nobody drops, so memory stays bounded over hours of auto mode.

export interface Live {
  phase: string;
  log: string[];
  // The file edits the run made so far, newest last.
  edits?: LiveEdit[];
}

export type LiveEvent = { runId: string; kind: "phase" | "log"; value: string } | { runId: string; kind: "edit"; edit: LiveEdit };

const MAX_LIVE_EDITS = 40;
export const MAX_RUNS = 32;
// How long events gather before they're applied: fast enough to read as live, few enough updates
// that six streaming runs don't keep the page busy. A timer, not an animation frame, so a hidden
// window keeps its log current instead of piling events up.
export const BEAT_MS = 50;

interface LiveState {
  runs: Record<string, Live>;
}

export const useLive = create<LiveState>(() => ({ runs: {} }));

const EMPTY: Live = { phase: "", log: [] };
let queue: LiveEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function apply(runs: Record<string, Live>, event: LiveEvent): Record<string, Live> {
  const live = runs[event.runId] ?? EMPTY;
  const next =
    event.kind === "edit" ? { ...live, edits: [...(live.edits ?? []), event.edit].slice(-MAX_LIVE_EDITS) }
    : event.kind === "phase" ? { ...live, phase: event.value }
    : { ...live, log: appendLog(live.log, event.value) };
  // Re-inserted last, so the oldest runs are the first the cap lets go.
  const { [event.runId]: _, ...rest } = runs;
  return { ...rest, [event.runId]: next };
}

const capped = (runs: Record<string, Live>) => {
  const ids = Object.keys(runs);
  return ids.length <= MAX_RUNS ? runs : Object.fromEntries(ids.slice(-MAX_RUNS).map((id) => [id, runs[id]]));
};

// Applies everything gathered so far, at once.
export function flushLive() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;
  const events = queue;
  queue = [];
  useLive.setState((s) => ({ runs: capped(events.reduce(apply, s.runs)) }));
}

export function pushLive(event: LiveEvent) {
  queue.push(event);
  timer ??= setTimeout(flushLive, BEAT_MS);
}

// A run that settled: what it's doing no longer matters, its result is on its stage or task.
export function dropLive(runId: string) {
  queue = queue.filter((e) => e.runId !== runId);
  if (!useLive.getState().runs[runId]) return;
  useLive.setState((s) => ({ runs: Object.fromEntries(Object.entries(s.runs).filter(([id]) => id !== runId)) }));
}

// A run's phase set at once, for what dhrive says itself before the CLI does ("Waiting for…").
export function setPhase(runId: string, phase: string) {
  pushLive({ runId, kind: "phase", value: phase });
  flushLive();
}

const NO_EDITS: LiveEdit[] = [];
export const useLiveRun = (runId: string | null | undefined) => useLive((s) => (runId ? s.runs[runId] : undefined));
export const useLivePhase = (runId: string | null | undefined) => useLive((s) => (runId ? s.runs[runId]?.phase : undefined));
export const useLiveLast = (runId: string | null | undefined) => useLive((s) => (runId ? s.runs[runId]?.log[s.runs[runId].log.length - 1] : undefined));
export const useLiveEdits = (runId: string | null | undefined) => useLive((s) => (runId ? s.runs[runId]?.edits : undefined) ?? NO_EDITS);
