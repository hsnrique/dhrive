import { describe, expect, it } from "vitest";

import { inFolder } from "./editing";

const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("one writer per folder", () => {
  it("whatever the timing, two writers never hold one folder at once, and each gets it in the order asked", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const random = prng(seed);
      const holding = new Map<string, number>();
      const order = new Map<string, number[]>();
      const asked = new Map<string, number[]>();
      const writers = Array.from({ length: 16 }, (_, i) => {
        const folder = random() < 0.5 ? "/a" : "/b";
        asked.set(folder, [...(asked.get(folder) ?? []), i]);
        return inFolder(folder, async () => {
          holding.set(folder, (holding.get(folder) ?? 0) + 1);
          expect(holding.get(folder), `seed ${seed}: one writer in ${folder}`).toBe(1);
          order.set(folder, [...(order.get(folder) ?? []), i]);
          await wait(Math.floor(random() * 3));
          holding.set(folder, holding.get(folder)! - 1);
          if (random() < 0.2) throw new Error("a writer that fails still lets go");
        }).catch(() => undefined);
      });
      await Promise.all(writers);
      expect(order, `seed ${seed}: in the order asked`).toEqual(asked);
    }
  });
});
