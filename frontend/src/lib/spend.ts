import type { Usage } from "./api";

// What a company's task spent, in the tokens its CLI reported, kept by what the run was doing: the
// task itself, the fixes after failed checks, the review, its territory and a merge conflict. It is
// how dhrive finds where tokens go before trying to spend fewer.

export const SPENT_ON = ["task", "fix", "review", "territory", "conflict"] as const;
export type SpentOn = (typeof SPENT_ON)[number];

export interface Tokens {
  input: number;
  cached: number;
  output: number;
}
export type Spent = Tokens & { by: Partial<Record<SpentOn, Tokens>> };

const NONE: Tokens = { input: 0, cached: 0, output: 0 };
const plus = (a: Tokens, b: Tokens): Tokens => ({ input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output });

// A CLI that reported nothing leaves the count as it was: unknown is never counted as zero spent.
export function addSpend(spent: Spent | undefined, on: SpentOn, usage: Usage | null | undefined): Spent | undefined {
  if (!usage) return spent;
  const run = { input: usage.inputTokens, cached: usage.cachedTokens ?? 0, output: usage.outputTokens };
  const total = plus(spent ?? NONE, run);
  return { ...total, by: { ...spent?.by, [on]: plus(spent?.by[on] ?? NONE, run) } };
}

export function totalOf(spents: (Spent | undefined)[]): Tokens {
  return spents.reduce<Tokens>((sum, s) => (s ? plus(sum, s) : sum), NONE);
}

// 980, 4.2k, 41k, 1.3M: a number to glance at, not to audit.
export function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export const spendLine = (t: Tokens) => `${tokens(t.input)} in · ${tokens(t.output)} out`;
export const cachedShare = (t: Tokens) => (t.input ? Math.round((t.cached / t.input) * 100) : 0);
// A total in one figure, with what it's made of for a tooltip.
export const totalLine = (t: Tokens) => `${tokens(t.input + t.output)} tokens`;
export const totalDetail = (t: Tokens) => `${spendLine(t)} · ${cachedShare(t)}% of input from cache`;

// The breakdown, for a tooltip: each kind of run, then how much of the input came from the cache.
export function spendDetail(spent: Spent): string {
  const parts = SPENT_ON.flatMap((on) => {
    const t = spent.by[on];
    return t ? [`${on} ${spendLine(t)}`] : [];
  });
  return [...parts, `${cachedShare(spent)}% of input from cache`].join(" · ");
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const savedTokens = (v: unknown): Tokens | null => {
  const t = v as Record<string, unknown> | null;
  const [input, cached, output] = [count(t?.input), count(t?.cached), count(t?.output)];
  return input === null || cached === null || output === null ? null : { input, cached, output };
};

// A task's spend as it comes back from disk, or nothing if it doesn't look like one.
export function savedSpent(value: unknown): Spent | undefined {
  const total = savedTokens(value);
  if (!total) return undefined;
  const by = (value as { by?: Record<string, unknown> }).by ?? {};
  const kept = SPENT_ON.flatMap((on) => {
    const t = savedTokens(by[on]);
    return t ? [[on, t] as const] : [];
  });
  return { ...total, by: Object.fromEntries(kept) };
}
