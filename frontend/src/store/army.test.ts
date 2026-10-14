import { beforeEach, describe, expect, it, vi } from "vitest";

const archived: unknown[][] = [];
vi.mock("@/lib/api", () => ({
  readCompanyRecord: vi.fn(async () => null),
  saveCompanyRecord: vi.fn(async () => undefined),
  archiveCompanyRecord: vi.fn(async (_p: string, _n: string, items: unknown[]) => void archived.push(items)),
}));

const { useApp } = await import("./app");
const { useCompany } = await import("./company");
const { mergedArmy, useArmy } = await import("./army");
const { newAgent } = await import("@/lib/army");

const P = "p1";
const army = () => useArmy.getState().byProject[P] ?? [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a company's army in its store", () => {
  beforeEach(() => {
    archived.length = 0;
    useApp.setState({ projects: [], choices: { plan: { engine: "claude-code", model: "opus" }, code: null } });
    useCompany.setState({ agents: {}, choice: null });
    useArmy.setState({ byProject: {} });
  });

  it("hires on the company's agent and refuses a name it already has", () => {
    expect(useArmy.getState().hire(P, "Back", "APIs")).toBe(true);
    expect(useArmy.getState().hire(P, " back ", "again")).toBe(false);
    expect(army().map((a) => [a.name, a.engine, a.model])).toEqual([["Back", "claude-code", "opus"]]);
  });

  it("fills the squad without doubling anyone, and never renames onto another agent", () => {
    useArmy.getState().hire(P, "QA", "");
    useArmy.getState().hireSquad(P);
    expect(army().map((a) => a.name)).toEqual(["QA", "Back", "Front", "Docs", "Growth"]);
    const [qa] = army();
    expect(useArmy.getState().edit(P, qa.id, { name: "front" })).toBe(false);
    expect(useArmy.getState().edit(P, qa.id, { name: "Tests", role: "  Covers it all " })).toBe(true);
    expect(army()[0]).toMatchObject({ name: "Tests", role: "Covers it all" });
  });

  it("puts a dismissed agent in the archive, not just away", async () => {
    useArmy.getState().hire(P, "Docs", "Writes it down");
    useArmy.getState().dismiss(P, army()[0].id);
    await settle();
    expect(army()).toEqual([]);
    expect(archived.flat()).toMatchObject([{ name: "Docs", role: "Writes it down" }]);
  });

  it("keeps both what the file held and what was hired before it was read", () => {
    const choice = { engine: "codex" as const, model: "" };
    const saved = [newAgent("Back", "", choice)!, newAgent("Front", "", choice)!];
    const now = [newAgent("front", "mine", choice)!];
    expect(mergedArmy(saved, now).map((a) => a.name)).toEqual(["Back", "front"]);
  });
});
