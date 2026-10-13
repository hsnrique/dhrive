import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  readCompanyRecord: vi.fn(async () => null),
  saveCompanyRecord: vi.fn(async () => undefined),
  archiveCompanyRecord: vi.fn(async () => undefined),
  readDocuments: vi.fn(async () => [{ id: "mission", text: "# Mission" }, { id: "roadmap", text: null }]),
  runStep: vi.fn(() => new Promise(() => {})),
  stopRun: vi.fn(async () => undefined),
}));

const { useApp } = await import("./app");
const { EMPTY_DAY, useDay } = await import("./day");
const { useDocuments } = await import("./documents");

const P = "p1";

describe("a company's documents", () => {
  beforeEach(() => {
    useApp.setState({ projects: [{ id: P, name: "planilha.", folder: "/planilha", createdAt: 0 }], clis: [{ engine: "claude-code", installed: true }] as never, choices: { plan: { engine: "claude-code", model: "opus" }, code: null } });
    useDay.setState({ byProject: { [P]: { ...EMPTY_DAY } } });
  });

  it("reads what's written", async () => {
    await useDocuments.getState().load(P);
    expect(useDocuments.getState().byProject[P]).toEqual({ mission: "# Mission", roadmap: null });
  });

  it("queues each document once, however often it's asked for", () => {
    useDocuments.getState().write(P, ["roadmap", "design-guide"]);
    useDocuments.getState().write(P, ["roadmap"]);
    expect(useDay.getState().byProject[P].tasks.map((t) => t.title)).toEqual(["Write the product roadmap", "Write the design guide"]);
  });
});
