import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine, PlanUsage } from "@/lib/api";

// Every planUsage call stays pending until the test settles it, so answers can land in any order.
const pending: { engine: Engine; resolve: (usage: PlanUsage) => void; reject: (error: Error) => void }[] = [];

vi.mock("@/lib/api", () => ({
  planUsage: vi.fn((engine: Engine) => new Promise((resolve, reject) => pending.push({ engine, resolve, reject }))),
}));

const { useUsage } = await import("./usage");
const api = await import("@/lib/api");

const usage = (percent: number): PlanUsage => ({ plan: "Claude Max", account: null, windows: [{ label: "Week", percent, resetsAt: null, warn: false }], shares: [], notes: [] });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const ENGINES: Engine[] = ["claude-code", "codex"];

describe("reading plan usage", () => {
  beforeEach(() => {
    pending.length = 0;
    vi.mocked(api.planUsage).mockClear();
    vi.useRealTimers();
    useUsage.setState({ known: {}, reading: {}, failed: {} });
  });

  it("asks each CLI once at a time, keeps the last answer through a failure, and asks again when stale", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { refresh } = useUsage.getState();
    void refresh("claude-code");
    void refresh("claude-code");
    expect(pending).toHaveLength(1);
    pending.shift()!.resolve(usage(9));
    await vi.waitFor(() => expect(useUsage.getState().reading["claude-code"]).toBe(false));
    void refresh("claude-code");
    expect(pending, "just read").toHaveLength(0);
    void refresh("claude-code", true);
    pending.shift()!.resolve(usage(10));
    await vi.waitFor(() => expect(useUsage.getState().known["claude-code"]?.usage.windows[0].percent).toBe(10));

    vi.advanceTimersByTime(6_000);
    void refresh("claude-code");
    pending.shift()!.reject(new Error("offline"));
    await vi.waitFor(() => expect(useUsage.getState().failed["claude-code"]).toContain("offline"));
    expect(useUsage.getState().known["claude-code"]?.usage.windows[0].percent).toBe(10);
    void refresh("claude-code");
    expect(pending, "a failure is retried at once").toHaveLength(1);
  });

  it("never reads one CLI twice at once, whatever order refreshes and answers come in", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = prng(seed);
      pending.length = 0;
      useUsage.setState({ known: {}, reading: {}, failed: {} });
      let answered = 0;
      for (let step = 0; step < 25; step++) {
        if (random() < 0.5) void useUsage.getState().refresh(ENGINES[Math.floor(random() * 2)]);
        else if (pending.length > 0) {
          const call = pending.splice(Math.floor(random() * pending.length), 1)[0];
          if (random() < 0.8) call.resolve(usage(++answered));
          else call.reject(new Error("offline"));
          await flush();
        }
        for (const engine of ENGINES) expect(pending.filter((c) => c.engine === engine).length, `seed ${seed}`).toBeLessThanOrEqual(1);
      }
      while (pending.length > 0) {
        pending.shift()!.resolve(usage(++answered));
        await flush();
      }
      for (const engine of ENGINES) expect(useUsage.getState().reading[engine] ?? false, `seed ${seed}: nothing left reading`).toBe(false);
    }
  });
});
