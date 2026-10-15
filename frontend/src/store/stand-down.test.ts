import { describe, expect, it, vi } from "vitest";

const stops = vi.hoisted(() => ({ auto: vi.fn(), plan: vi.fn(), day: vi.fn(), draft: vi.fn(), chat: vi.fn() }));
vi.mock("./auto", () => ({ useAuto: { getState: () => ({ byProject: { p1: { until: 1 } }, stop: stops.auto }) } }));
vi.mock("./day", () => ({ useDay: { getState: () => ({ stopPlan: stops.plan, stop: stops.day }) } }));
vi.mock("./company", () => ({ useCompany: { getState: () => ({ stop: stops.draft }) } }));
vi.mock("./chat", () => ({ useChat: { getState: () => ({ stop: stops.chat }) } }));

const { standDown } = await import("./stand-down");

describe("standing a company down", () => {
  it("stops everything it has going before it's deleted: auto mode, tasks, plan, draft and chat", () => {
    standDown("p1");
    for (const stop of Object.values(stops)) expect(stop).toHaveBeenCalledWith("p1");
  });
});
