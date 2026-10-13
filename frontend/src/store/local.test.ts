import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalScan } from "@/lib/api";

// Each pull stays pending until the test settles it, so progress can arrive while it runs.
let settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
const scan = (installed: boolean): LocalScan => ({
  machine: { chip: "Apple M5", memoryBytes: 16 * 2 ** 30, freeDiskBytes: 2e11 },
  ollama: "running",
  codex: true,
  context: null,
  models: [{ id: "ornith:9b", label: "Ornith 9B", bytes: 5.6e9, fit: "good", installed }],
});
let installed = false;

vi.mock("@/lib/api", () => ({
  scanLocal: vi.fn(async () => scan(installed)),
  pullModel: vi.fn(() => new Promise<void>((resolve, reject) => (settle = { resolve, reject }))),
  stopPull: vi.fn(async () => settle?.reject(new Error("Stopped. Installing again picks up where it left off."))),
  startOllama: vi.fn(async () => undefined),
  saveThread: vi.fn(async () => undefined),
}));

const { useLocal } = await import("./local");

describe("local models", () => {
  beforeEach(() => {
    installed = false;
    useLocal.setState({ scan: scan(false), pulls: {} });
  });

  it("shows progress while a model downloads and forgets the pull once it's installed", async () => {
    const done = useLocal.getState().install("ornith:9b");
    useLocal.getState().onPull({ model: "ornith:9b", status: "downloading", completed: 280, total: 560 });
    expect(useLocal.getState().pulls["ornith:9b"]).toMatchObject({ completed: 280, total: 560, error: null });

    installed = true;
    settle!.resolve();
    await done;

    expect(useLocal.getState().pulls).toEqual({});
    expect(useLocal.getState().scan?.models[0].installed).toBe(true);
  });

  it("keeps a stopped pull's reason on screen until it's installed again", async () => {
    const done = useLocal.getState().install("ornith:9b");
    useLocal.getState().stop("ornith:9b");
    await done;
    expect(useLocal.getState().pulls["ornith:9b"].error).toMatch(/Stopped/);

    const again = useLocal.getState().install("ornith:9b");
    expect(useLocal.getState().pulls["ornith:9b"].error).toBeNull();
    settle!.resolve();
    await again;
  });

  it("ignores progress for a model it isn't pulling", () => {
    useLocal.getState().onPull({ model: "other:1b", status: "downloading", completed: 1, total: 2 });
    expect(useLocal.getState().pulls).toEqual({});
  });
});
