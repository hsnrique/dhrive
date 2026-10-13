import { describe, expect, it } from "vitest";

import { failuresAfter, limitReached, timeLeft } from "./auto";
import type { Task } from "./day";

const window = (label: string, percent: number, resetsAt: number | null = null) => ({ label, percent, resetsAt, warn: false });
const usage = (...windows: ReturnType<typeof window>[]) => ({ plan: null, account: null, windows, shares: [], notes: [] });

describe("auto mode", () => {
  it("stops near a plan limit, unless that window has reset", () => {
    expect(limitReached(usage(window("5-hour", 40), window("Weekly", 93)), "sonnet", 0)).toBe("Weekly limit is at 93%");
    expect(limitReached(usage(window("5-hour", 95, 10)), "sonnet", 20_000)).toBeNull();
    expect(limitReached(undefined, "sonnet", 0)).toBeNull();
  });

  it("minds a model's own window only when the agent uses that model", () => {
    const fable = usage(window("Week, all models", 60), window("Week, Fable", 92));
    expect(limitReached(fable, "sonnet", 0)).toBeNull();
    expect(limitReached(fable, "", 0)).toBeNull();
    expect(limitReached(fable, "fable", 0)).toBe("Week, Fable limit is at 92%");
    expect(limitReached(usage(window("Week, all models", 95)), "sonnet", 0)).toBe("Week, all models limit is at 95%");
  });

  it("says how long it has left", () => {
    expect(timeLeft(102 * 60_000, 0)).toBe("1 h 42 min left");
    expect(timeLeft(2 * 3_600_000, 0)).toBe("2 h left");
    expect(timeLeft(30_000, 0)).toBe("1 min left");
    expect(timeLeft(0, 10)).toBe("0 min left");
  });

  it("counts failures in a row across rounds, a success resetting them", () => {
    const t = (status: string) => ({ status }) as Task;
    expect(failuresAfter([t("done"), t("failed")], 0)).toBe(1);
    expect(failuresAfter([t("failed")], 1)).toBe(2);
    expect(failuresAfter([t("failed"), t("done")], 1)).toBe(0);
  });
});
