import { describe, expect, it } from "vitest";

import type { UsageWindow } from "@/lib/api";
import { resetsIn, resetText, restoreUsage, shownPercent } from "./usage";

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const at = (minutes: number) => NOW / 1000 + minutes * 60;
const window = (resetsAt: number | null, percent = 40): UsageWindow => ({ label: "Week", percent, resetsAt, warn: false });

describe("plan usage", () => {
  it("counts a window that has reset since it was read as empty", () => {
    expect(shownPercent(window(at(30)), NOW)).toBe(40);
    expect(shownPercent(window(at(-1)), NOW)).toBe(0);
    expect(shownPercent(window(null), NOW)).toBe(40);
  });

  it("says how long until a reset", () => {
    expect(resetsIn(at(12), NOW)).toBe("12 min");
    expect(resetsIn(at(226), NOW)).toBe("3 h 46 min");
    expect(resetsIn(at(60 * 52), NOW)).toBe("2 d 4 h");
    expect(resetsIn(at(-5), NOW)).toBe("0 min");
    expect(resetsIn(at(180), NOW)).toBe("3 h");
    expect(resetsIn(at(60 * 24 * 6), NOW)).toBe("6 d");
  });

  it("adds the day and time once a reset is a day or more away", () => {
    const clock = () => "Mon 09:59";
    expect(resetText(window(at(226)), NOW, clock)).toBe("Resets in 3 h 46 min");
    expect(resetText(window(at(60 * 52)), NOW, clock)).toBe("Resets Mon 09:59, in 2 d 4 h");
    expect(resetText(window(at(-1)), NOW, clock)).toBe("Reset since it was read");
    expect(resetText(window(null), NOW, clock)).toBeNull();
  });

  it("comes back from storage only when it still has an answer's shape", () => {
    const usage = { plan: "Claude Max", account: null, windows: [window(at(60))], shares: [], notes: [] };
    const saved = JSON.parse(JSON.stringify({ "claude-code": { usage, at: NOW }, codex: { usage: { windows: [{ label: 1 }] }, at: NOW }, ollama: { usage } }));
    expect(restoreUsage(saved)).toEqual({ "claude-code": { usage, at: NOW } });
    expect(restoreUsage(null)).toEqual({});
    expect(restoreUsage("x")).toEqual({});
  });
});
