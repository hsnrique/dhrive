import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ saveThread: vi.fn(async () => undefined), notify: vi.fn(async () => undefined) }));

const { useApp } = await import("./app");
const { BEAT_MS, MAX_RUNS, dropLive, flushLive, setPhase, useLive } = await import("./live");

const progress = (runId: string, kind: "phase" | "log" | "edit", value: string) => useApp.getState().onProgress({ runId, kind, value });

beforeEach(() => {
  flushLive();
  useLive.setState({ runs: {} });
});
afterEach(() => vi.useRealTimers());

describe("a run's live state", () => {
  it("collects edits in order, keeps only the latest forty, and skips what isn't an edit", () => {
    for (let i = 0; i < 45; i++) progress("r1", "edit", JSON.stringify({ path: `f${i}.ts`, before: "", after: `${i}` }));
    progress("r1", "edit", "nope");
    flushLive();
    const edits = useLive.getState().runs.r1.edits!;
    expect(edits).toHaveLength(40);
    expect([edits[0].path, edits[39].path]).toEqual(["f5.ts", "f44.ts"]);
  });

  it("lands a burst of events in one update per beat, and never touches the app's store", () => {
    vi.useFakeTimers();
    const updates = vi.fn();
    const appUpdates = vi.fn();
    const stop = [useLive.subscribe(updates), useApp.subscribe(appUpdates)];
    progress("r1", "phase", "Editing");
    for (let i = 0; i < 50; i++) progress("r1", "log", `line ${i}`);
    expect(updates).not.toHaveBeenCalled();
    vi.advanceTimersByTime(BEAT_MS);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(appUpdates).not.toHaveBeenCalled();
    expect(useLive.getState().runs.r1.phase).toBe("Editing");
    expect(useLive.getState().runs.r1.log.slice(-1)).toEqual(["line 49"]);
    stop.forEach((s) => s());
  });

  it("is gone once its run settles, along with anything of it still on the way", () => {
    progress("r1", "phase", "Editing");
    flushLive();
    progress("r1", "log", "late line");
    dropLive("r1");
    flushLive();
    expect(useLive.getState().runs).toEqual({});
  });

  it("shows what dhrive says itself at once", () => {
    setPhase("r1", "Waiting");
    expect(useLive.getState().runs.r1.phase).toBe("Waiting");
  });

  it("holds at most the latest runs, so a long day of runs nobody dropped stays bounded", () => {
    for (let i = 0; i <= MAX_RUNS; i++) progress(`r${i}`, "phase", "Editing");
    progress("r0", "log", "still going");
    flushLive();
    const ids = Object.keys(useLive.getState().runs);
    expect(ids).toHaveLength(MAX_RUNS);
    expect(ids).toContain("r0");
    expect(ids).not.toContain("r1");
  });
});
