import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the company's folder: what each file holds, what each call did, and how long each
// call takes, so writes can be made to overlap.
const disk = new Map<string, unknown>();
const archive = new Map<string, unknown[]>();
const calls: string[] = [];
let busy = 0;
let delay = () => 0;
let failRead = false;
let failArchive = false;
const later = () => new Promise((resolve) => setTimeout(resolve, delay()));

vi.mock("@/lib/api", () => ({
  readCompanyRecord: vi.fn(async (project: string) => {
    await later();
    if (failRead) throw new Error("The company's tasks file is damaged");
    return disk.get(project) ?? null;
  }),
  saveCompanyRecord: vi.fn(async (project: string, _name: string, value: unknown) => {
    busy += 1;
    expect(busy, "one write at a time per project").toBe(1);
    await later();
    disk.set(project, value);
    calls.push(`save ${JSON.stringify(value)}`);
    busy -= 1;
  }),
  archiveCompanyRecord: vi.fn(async (project: string, _name: string, items: unknown[]) => {
    await later();
    if (failArchive) throw new Error("disk full");
    archive.set(project, [...(archive.get(project) ?? []), ...items]);
    calls.push(`archive ${JSON.stringify(items)}`);
  }),
}));

const { useApp } = await import("./app");
const { keeper } = await import("./records");

// A store of numbers per project, merged with the file by union.
function numbers() {
  const state = new Map<string, number[]>();
  const kept = keeper("tasks", (id) => state.get(id) ?? [], (id, saved) => {
    const file = Array.isArray(saved) ? (saved as number[]) : [];
    const now = state.get(id) ?? [];
    state.set(id, [...file.filter((n) => !now.includes(n)), ...now]);
    return now.length > 0;
  });
  const push = (id: string, n: number, letGo: number[] = []) => {
    state.set(id, [...(state.get(id) ?? []).filter((x) => !letGo.includes(x)), n]);
    kept.persist(id, letGo);
  };
  return { state, kept, push };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

describe("keeper", () => {
  beforeEach(() => {
    disk.clear();
    archive.clear();
    calls.length = 0;
    delay = () => 0;
    failRead = failArchive = false;
    useApp.setState({ errors: [] });
  });

  it("merges the file in before writing, so a change made while it's read never drops what it held", async () => {
    disk.set("p", [1, 2]);
    delay = () => 5;
    const { state, push } = numbers();
    push("p", 3);
    await settle();
    expect(disk.get("p")).toEqual([1, 2, 3]);
    expect(state.get("p")).toEqual([1, 2, 3]);
  });

  it("writes one at a time and the last state always lands last, however the writes overlap", async () => {
    for (let round = 0; round < 25; round += 1) {
      disk.clear();
      delay = () => Math.floor(Math.random() * 4);
      const { state, push } = numbers();
      const count = 2 + Math.floor(Math.random() * 12);
      for (let n = 0; n < count; n += 1) {
        push("p", n);
        if (Math.random() < 0.5) await new Promise((resolve) => setTimeout(resolve, Math.random() * 4));
      }
      await settle();
      expect(disk.get("p")).toEqual(state.get("p"));
    }
  });

  it("archives what was let go before the save that drops it, and keeps it when archiving fails", async () => {
    const { push } = numbers();
    push("p", 1);
    await settle();
    failArchive = true;
    push("p", 2, [1]);
    await settle();
    expect(disk.get("p"), "no save drops what isn't archived").toEqual([1]);
    expect(useApp.getState().errors[0]?.text).toContain("disk full");
    failArchive = false;
    push("p", 3);
    await settle();
    expect(archive.get("p")).toEqual([1]);
    expect(disk.get("p")).toEqual([2, 3]);
    expect(calls.slice(-2)).toEqual(["archive [1]", "save [2,3]"]);
  });

  it("never saves over a file it couldn't read", async () => {
    disk.set("p", [7]);
    failRead = true;
    const { push } = numbers();
    push("p", 8);
    await settle();
    expect(disk.get("p")).toEqual([7]);
    expect(useApp.getState().errors[0]?.text).toContain("damaged");
    failRead = false;
    push("p", 9);
    await settle();
    expect(disk.get("p"), "read again, then merged").toEqual([7, 8, 9]);
  });

  it("reads every project's file as soon as the project is known", async () => {
    disk.set("q", [5]);
    const { state } = numbers();
    useApp.setState({ projects: [{ id: "q", name: "q", folder: "/q", createdAt: 1, allowed: [] }] as never });
    await settle();
    expect(state.get("q")).toEqual([5]);
    expect(calls, "reading alone writes nothing").toEqual([]);
  });
});
