import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Cli, Engine } from "@/lib/api";

const cli = (engine: Engine, version: string | null): Cli => ({ engine, label: engine, installed: version !== null, docsUrl: "", version, updatedFrom: null, missing: [] });
let clis: Cli[] = [];

vi.mock("@/lib/api", () => ({
  listClis: vi.fn(async () => clis),
  listProjects: vi.fn(async () => []),
  listModels: vi.fn(async (engine: Engine) => [{ id: "", label: `${engine} default`, detail: null }]),
  saveThread: vi.fn(async () => undefined),
}));

const { listModels } = await import("@/lib/api");
const { useApp } = await import("./app");
const { modelName } = await import("@/lib/names");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("CLI updates", () => {
  beforeEach(async () => {
    clis = [cli("claude-code", "2.1.284"), cli("codex", "0.158.0"), cli("ollama", null)];
    useApp.setState({ clis: [], models: {}, choices: { plan: null, code: null } });
    await useApp.getState().boot();
    await settle();
    vi.mocked(listModels).mockClear();
  });

  it("asks every installed CLI for its models on launch", () => {
    expect(Object.keys(useApp.getState().models).sort()).toEqual(["claude-code", "codex"]);
  });

  it("asks again only the CLI whose version changed", async () => {
    clis = [cli("claude-code", "2.1.290"), cli("codex", "0.158.0"), cli("ollama", null)];
    await useApp.getState().refreshClis();
    await settle();
    expect(vi.mocked(listModels).mock.calls).toEqual([["claude-code"]]);
  });

  it("gives a CLI that appears later a route to run on", async () => {
    clis = [cli("claude-code", null), cli("codex", null), cli("ollama", null)];
    useApp.setState({ clis, choices: { plan: null, code: null } });
    clis = [cli("claude-code", null), cli("codex", "0.158.0"), cli("ollama", null)];
    await useApp.getState().refreshClis();
    expect(useApp.getState().choices.code).toEqual({ engine: "codex", model: "" });
  });
});

describe("modelName", () => {
  it("prefers the name the CLI reported, then Claude's aliases, then the id as typed", () => {
    const options = [{ id: "claude-fable-5-1[1m]", label: "Fable", detail: null }];
    expect(modelName("claude-fable-5-1[1m]", options)).toBe("Fable");
    expect(modelName("opus")).toBe("Opus");
    expect(modelName("my-own-model")).toBe("my-own-model");
    expect(modelName("", options)).toBe("Default");
  });
});

describe("startup", () => {
  it("fills the sidebar once the projects are read, without waiting for every CLI to answer", async () => {
    const { listClis, listProjects } = await import("@/lib/api");
    const project = { id: "p1", name: "Acme", folder: "/acme" } as Awaited<ReturnType<typeof listProjects>>[number];
    vi.mocked(listProjects).mockResolvedValueOnce([project]);
    let answer: (clis: Cli[]) => void = () => {};
    vi.mocked(listClis).mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    useApp.setState({ booted: false, projects: [], projectsRead: false });
    const booting = useApp.getState().boot();
    await settle();
    expect(useApp.getState()).toMatchObject({ projects: [project], projectsRead: true, booted: false });
    answer([]);
    await booting;
    expect(useApp.getState().booted).toBe(true);
  });
});
