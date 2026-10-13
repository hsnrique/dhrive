import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ saveThread: vi.fn(async () => undefined), notify: vi.fn(async () => undefined) }));

const { useApp } = await import("./app");

describe("a run's live edits", () => {
  it("collect in order, keep only the latest forty, and skip what isn't an edit", () => {
    useApp.setState({ live: {} });
    const edit = (i: number) => useApp.getState().onProgress({ runId: "r1", kind: "edit", value: JSON.stringify({ path: `f${i}.ts`, before: "", after: `${i}` }) });
    for (let i = 0; i < 45; i++) edit(i);
    useApp.getState().onProgress({ runId: "r1", kind: "edit", value: "nope" });
    const edits = useApp.getState().live.r1.edits!;
    expect(edits).toHaveLength(40);
    expect([edits[0].path, edits[39].path]).toEqual(["f5.ts", "f44.ts"]);
  });
});
