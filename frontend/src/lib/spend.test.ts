import { describe, expect, it } from "vitest";

import { addSpend, savedSpent, spendDetail, spendLine, tokens, totalOf } from "./spend";

const usage = (inputTokens: number, cachedTokens: number, outputTokens: number) => ({ inputTokens, cachedTokens, outputTokens, totalCostUsd: null, numTurns: 1, model: null });

describe("what a task spent", () => {
  it("adds every run to the total and to what it was doing, and counts a silent CLI as unknown, not zero", () => {
    let spent = addSpend(undefined, "task", usage(30_000, 24_000, 1_500));
    spent = addSpend(spent, "fix", usage(6_000, 5_000, 300));
    spent = addSpend(spent, "fix", usage(4_000, 3_000, 200));
    expect(spent).toEqual({ input: 40_000, cached: 32_000, output: 2_000, by: { task: { input: 30_000, cached: 24_000, output: 1_500 }, fix: { input: 10_000, cached: 8_000, output: 500 } } });
    expect(addSpend(spent, "review", null)).toBe(spent);
    expect(addSpend(undefined, "task", null)).toBeUndefined();
  });

  it("sums a company's tasks, skipping the ones with nothing reported", () => {
    const a = addSpend(undefined, "task", usage(10, 5, 1));
    expect(totalOf([a, undefined, a])).toEqual({ input: 20, cached: 10, output: 2 });
  });

  it("reads as a glance, with the breakdown kept for the tooltip", () => {
    expect([980, 4_200, 41_400, 1_300_000, 2_000_000].map(tokens)).toEqual(["980", "4.2k", "41k", "1.3M", "2M"]);
    const spent = addSpend(addSpend(undefined, "task", usage(30_000, 24_000, 1_500)), "review", usage(10_000, 0, 500))!;
    expect(spendLine(spent)).toBe("40k in · 2k out");
    expect(spendDetail(spent)).toBe("task 30k in · 1.5k out · review 10k in · 500 out · 60% of input from cache");
  });

  it("comes back from disk only when it still looks like a count", () => {
    const spent = addSpend(undefined, "conflict", usage(7, 2, 3));
    expect(savedSpent(JSON.parse(JSON.stringify(spent)))).toEqual(spent);
    expect(savedSpent({ input: 1, cached: 0, output: 2, by: { task: { input: "x" }, nope: { input: 1, cached: 0, output: 1 } } })).toEqual({ input: 1, cached: 0, output: 2, by: {} });
    expect(savedSpent({ input: -1, cached: 0, output: 0 })).toBeUndefined();
    expect(savedSpent("lots")).toBeUndefined();
  });
});
