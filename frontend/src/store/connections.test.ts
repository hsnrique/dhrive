import { describe, expect, it, vi } from "vitest";

import type { Connections, Engine } from "@/lib/api";

// Every listConnections call stays pending until the test settles it, so answers land in any order.
const pending: { key: string; resolve: (value: Connections) => void; reject: (error: Error) => void }[] = [];

vi.mock("@/lib/api", () => ({
  listConnections: vi.fn((engine: Engine, folder: string) => new Promise((resolve, reject) => pending.push({ key: `${engine}\n${folder}`, resolve, reject }))),
}));

const { useConnections } = await import("./connections");

const answer = (n: number): Connections => ({ servers: [], skills: [], plugins: [{ name: `p${n}`, detail: null, source: null, on: true }], agents: [], hooks: [] });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const ASKS: [Engine, string][] = [["claude-code", "/a"], ["claude-code", "/b"], ["codex", "/a"], ["claude-code", ""]];

describe("asking what a CLI has connected", () => {
  it("asks once per CLI and folder at a time, keeps each answer under its own key, and a failure keeps the last one", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = prng(seed);
      pending.length = 0;
      useConnections.setState({ seen: {} });
      const last = new Map<string, number>();
      let n = 0;
      for (let step = 0; step < 30; step++) {
        if (random() < 0.5) void useConnections.getState().refresh(...ASKS[Math.floor(random() * ASKS.length)]);
        else if (pending.length > 0) {
          const call = pending.splice(Math.floor(random() * pending.length), 1)[0];
          if (random() < 0.75) {
            call.resolve(answer(++n));
            last.set(call.key, n);
          } else call.reject(new Error("offline"));
          await flush();
        }
        const keys = pending.map((c) => c.key);
        expect(new Set(keys).size, `seed ${seed}: one question per CLI and folder`).toBe(keys.length);
      }
      await flush();
      for (const [key, value] of last) expect(useConnections.getState().seen[key].value?.plugins[0].name, `seed ${seed}`).toBe(`p${value}`);
    }
  });
});
