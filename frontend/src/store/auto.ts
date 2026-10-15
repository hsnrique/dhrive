import { create } from "zustand";

import { keepAwake } from "@/lib/api";
import { failuresAfter, limitReached, MAX_FAILURES } from "@/lib/auto";
import { stuckOn } from "@/lib/day";
import { entry } from "@/lib/log";
import { RECHECK_MS } from "@/lib/logistics";
import { companyAgent } from "./company";
import { NOTHING as NO_SUGGESTIONS, useDay } from "./day";
import { useLog } from "./log";
import { useUsage } from "./usage";

// Auto mode: the owner hands the company over for some hours and it works on its own, round after
// round. A round runs what's queued; with nothing queued, the agent suggests the next tasks and they
// run without waiting for an OK. It stops by itself, and says why, when the time is up, when the
// agent finds nothing worth doing, when the CLI's plan nears its limit, or after failures in a row.

export interface Auto {
  // While on, when it stops starting new work.
  until: number | null;
  // Why it stopped by itself, until it starts again.
  ended: string | null;
}

export const OFF: Auto = { until: null, ended: null };
const NOTHING = "Nothing worth doing right now";

const STUCK = "Its next tasks can't start";

// What a round can still move: tasks running, and planned ones that can start now or once what they
// wait for is done. One stuck behind a failed or stopped task isn't open; counting it gave a round
// with nothing to start, then the next, a loop that never yielded (and froze the window on Ollama,
// which has no plan to check between rounds).
const open = (projectId: string) => {
  const tasks = useDay.getState().byProject[projectId]?.tasks ?? [];
  return tasks.filter((t) => t.status === "running" || (t.status === "planned" && !stuckOn(t, tasks).length));
};
const pause = (ms: number) => new Promise((done) => setTimeout(done, Math.max(0, ms)));

async function nearLimit(projectId: string): Promise<string | null> {
  const agent = companyAgent(projectId);
  if (!agent) return "No agent to work for the company";
  // Ollama runs on this Mac: there's no plan to run out of.
  if (agent.engine === "ollama") return null;
  await useUsage.getState().refresh(agent.engine, true);
  return limitReached(useUsage.getState().known[agent.engine]?.usage, agent.model, Date.now());
}

interface AutoState {
  byProject: Record<string, Auto>;
  start: (projectId: string, hours: number) => void;
  stop: (projectId: string) => void;
}

export const useAuto = create<AutoState>((set, get) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const on = (projectId: string, until: number) => get().byProject[projectId]?.until === until;
  const put = (projectId: string, auto: Auto) => set({ byProject: { ...get().byProject, [projectId]: auto } });
  const end = (projectId: string, ended: string | null) => {
    clearTimeout(timers.get(projectId));
    timers.delete(projectId);
    put(projectId, { until: null, ended });
    useLog.getState().add(projectId, entry("auto", ended ? `stopped · ${ended}` : "stopped"));
  };

  // One round: work through what's queued, suggesting more first if nothing is. Says why to stop, if it should.
  const round = async (projectId: string, failures: number): Promise<{ stop: string | null; failures: number; idle?: boolean }> => {
    const day = useDay.getState();
    if (!open(projectId).length) {
      await day.plan(projectId);
      day.accept(projectId);
      const error = useDay.getState().byProject[projectId]?.error;
      if (!open(projectId).length) return { stop: error && error !== NO_SUGGESTIONS ? error : NOTHING, failures };
    }
    const before = new Map(open(projectId).map((t) => [t.id, t.status]));
    await day.run(projectId);
    const done = (useDay.getState().byProject[projectId]?.tasks ?? []).filter((t) => before.has(t.id));
    if (done.some((t) => t.status === "stopped")) return { stop: "Stopped", failures };
    // A round that moved nothing would only repeat itself: its tasks wait on a plan to reset (look
    // again later) or can't start at all (say so and stop).
    if (done.every((t) => t.status === before.get(t.id))) {
      return useDay.getState().byProject[projectId]?.held ? { stop: null, failures, idle: true } : { stop: STUCK, failures };
    }
    const streak = failuresAfter(done, failures);
    return { stop: streak >= MAX_FAILURES ? `${streak} tasks failed in a row` : null, failures: streak };
  };

  const loop = async (projectId: string, until: number) => {
    for (let failures = 0; on(projectId, until); ) {
      const why = Date.now() >= until ? "Time's up" : await nearLimit(projectId);
      if (why) return on(projectId, until) && end(projectId, why);
      const next = await round(projectId, failures);
      if (!on(projectId, until)) return;
      if (Date.now() >= until) return end(projectId, "Time's up");
      if (next.stop) return end(projectId, next.stop);
      failures = next.failures;
      // Always a real pause between rounds, so the loop never holds the page; a round whose tasks
      // wait on a plan waits as long as the army does before it looks again.
      await pause(next.idle ? Math.min(RECHECK_MS, until - Date.now()) : 0);
    }
  };

  return {
    byProject: {},
    start: (projectId, hours) => {
      if (get().byProject[projectId]?.until) return;
      const until = Date.now() + hours * 3_600_000;
      put(projectId, { until, ended: null });
      useLog.getState().add(projectId, entry("auto", `on for ${hours} h`));
      // ponytail: at the deadline the running task finishes and nothing new starts; a long task can run past it.
      timers.set(projectId, setTimeout(() => useDay.getState().hold(projectId), until - Date.now()));
      void loop(projectId, until);
    },
    stop: (projectId) => {
      end(projectId, null);
      useDay.getState().stopPlan(projectId);
      useDay.getState().stop(projectId);
    },
  };
});

// The Mac stays awake while any company is in auto mode, and only then.
let awake = false;
useAuto.subscribe(({ byProject }) => {
  const any = Object.values(byProject).some((a) => a.until !== null);
  if (any === awake) return;
  awake = any;
  void keepAwake(any).catch(() => {});
});

export const useAutoOf = (projectId: string) => useAuto((s) => s.byProject[projectId] ?? OFF);
