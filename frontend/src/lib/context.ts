import type { Engine } from "@/lib/api";
import { reportsDetails } from "@/lib/names";
import { keepsContext, type RunMessage, type Thread } from "@/lib/thread";

// A conversation's CLI sessions as the context meter shows them: one per CLI it continues, with the
// model its latest stage on that CLI ran, since Claude's window depends on the model.

export interface ThreadSession {
  engine: Engine;
  session: string;
  model: string;
}

export function sessionsOf(thread: Thread | undefined): ThreadSession[] {
  if (!thread || !keepsContext(thread)) return [];
  const stages = thread.messages.filter((m): m is RunMessage => m.role === "run").flatMap((m) => [m.plan, m.code]);
  return (Object.entries(thread.sessions) as [Engine, string | undefined][]).flatMap(([engine, session]) => {
    if (!session || !reportsDetails(engine)) return [];
    const latest = stages.filter((s) => s?.engine === engine).pop();
    return [{ engine, session, model: latest?.model ?? "" }];
  });
}

// "900", "49.9k", "1M": token counts at a glance.
export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export const percentOf = (used: number, max: number) => (max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0);

// Past 70% the session is worth compacting soon; past 90% it's about to be compacted for you.
export const fullness = (percent: number): "ok" | "high" | "full" => (percent >= 90 ? "full" : percent >= 70 ? "high" : "ok");
