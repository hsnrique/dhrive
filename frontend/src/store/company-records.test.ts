import { describe, expect, it, vi } from "vitest";

import { MAX_KEPT, type Task } from "@/lib/day";
import { MAX_ENTRIES, entry } from "@/lib/log";

// What a company had in the webview's storage before its records, and its folder's files since.
const legacy = new Map<string, string>([
  ["dhrive.company.days", JSON.stringify({ old: { tasks: [{ id: "t1", title: "Landing", area: "code", engine: "claude-code", model: "opus", prompt: "Build it", status: "done", result: "Done" }], plannedAt: 5, ask: true } })],
  ["dhrive.company.log", JSON.stringify({ old: [{ id: "e1", at: 1, kind: "owner", text: "hi" }], moved: [{ id: "stale", at: 1, kind: "owner", text: "old copy" }] })],
]);
vi.stubGlobal("localStorage", { getItem: (k: string) => legacy.get(k) ?? null, setItem: () => undefined });

const disk = new Map<string, unknown>();
const archived = new Map<string, unknown[]>();
disk.set("moved/log", [{ id: "e9", at: 9, kind: "agent", text: "already in its folder" }]);

vi.mock("@/lib/api", () => ({
  readCompanyRecord: vi.fn(async (project: string, name: string) => disk.get(`${project}/${name}`) ?? null),
  saveCompanyRecord: vi.fn(async (project: string, name: string, value: unknown) => void disk.set(`${project}/${name}`, value)),
  archiveCompanyRecord: vi.fn(async (project: string, name: string, items: unknown[]) => void archived.set(`${project}/${name}`, [...(archived.get(`${project}/${name}`) ?? []), ...items])),
  runStep: vi.fn(() => new Promise(() => undefined)),
  stopRun: vi.fn(),
}));

const { useApp } = await import("./app");
const { useDay } = await import("./day");
const { useLog } = await import("./log");

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const project = (id: string) => ({ id, name: id, folder: `/${id}`, createdAt: 1, allowed: [] });

describe("a company's records", () => {
  it("move over from the webview's storage once, and a company already in its folder keeps its folder's", async () => {
    useApp.setState({ projects: [project("old"), project("moved"), project("fresh")] as never });
    await settle();
    expect((disk.get("old/tasks") as { tasks: Task[]; ask: boolean }).tasks.map((t) => t.id)).toEqual(["t1"]);
    expect((disk.get("old/tasks") as { ask: boolean }).ask).toBe(true);
    expect(disk.get("old/log")).toEqual([{ id: "e1", at: 1, kind: "owner", text: "hi" }]);
    expect(useLog.getState().byProject.moved.map((e) => e.id), "the folder wins over the stale copy").toEqual(["e9"]);
    expect(disk.has("fresh/tasks") || disk.has("fresh/log"), "nothing to keep, no file made").toBe(false);
  });

  it("archive the oldest finished tasks and timeline entries before the save that lets them go", async () => {
    useApp.setState({ projects: [project("busy")] as never });
    await settle();
    const done = (n: number) => ({ id: `d${n}`, title: `Task ${n}`, area: "code", engine: "claude-code", model: "opus", prompt: "x", status: "done", runId: null, result: "ok" }) as Task;
    useDay.setState({ byProject: { ...useDay.getState().byProject, busy: { ...useDay.getState().byProject.busy, tasks: Array.from({ length: MAX_KEPT }, (_, n) => done(n)), plannedAt: null, planRunId: null, ask: false, first: false, error: null } } });
    useDay.getState().setAsk("busy", true);
    useDay.getState().queue("busy", { ...done(99), status: "planned" });
    await settle();
    expect((archived.get("busy/tasks") as Task[]).map((t) => t.id)).toEqual(["d0"]);
    expect((disk.get("busy/tasks") as { tasks: Task[] }).tasks).toHaveLength(MAX_KEPT);

    for (let n = 0; n < MAX_ENTRIES + 2; n += 1) useLog.getState().add("busy", entry("owner", `line ${n}`));
    await settle();
    expect((archived.get("busy/log") as { text: string }[]).map((e) => e.text)).toEqual(["line 0", "line 1"]);
    expect(disk.get("busy/log")).toHaveLength(MAX_ENTRIES);
  });
});
