import { describe, expect, it, vi } from "vitest";

// Every search stays pending until the test settles it, so answers can land in any order.
const pending: { query: string; resolve: (hits: unknown) => void; reject: (error: Error) => void }[] = [];

vi.mock("@/lib/api", () => ({
  searchConversations: vi.fn((query: string) => new Promise((resolve, reject) => pending.push({ query, resolve, reject }))),
}));

const { useSearch } = await import("./search");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const QUERIES = ["we", "web", "webhook", "x", "retry"];

describe("searching inside conversations", () => {
  it("keeps only the answer to the latest query, whatever order the answers come in", async () => {
    for (let seed = 1; seed <= 80; seed++) {
      const random = prng(seed);
      pending.length = 0;
      useSearch.setState({ hits: [], hitsFor: "" });
      let last = "";
      for (let step = 0; step < 12; step++) {
        if (random() < 0.5) {
          last = QUERIES[Math.floor(random() * QUERIES.length)];
          void useSearch.getState().find(last);
        } else if (pending.length > 0) {
          const call = pending.splice(Math.floor(random() * pending.length), 1)[0];
          if (random() < 0.8) call.resolve([{ conversationId: call.query, snippet: call.query }]);
          else call.reject(new Error("offline"));
        }
        await flush();
      }
      for (const call of pending.splice(0)) call.resolve([{ conversationId: call.query, snippet: call.query }]);
      await flush();
      const { hitsFor, hits } = useSearch.getState();
      expect(hitsFor, `seed ${seed}`).toBe(last);
      expect(hits.every((h) => h.conversationId === last), `seed ${seed}: no hits from an older query`).toBe(true);
    }
  });
});
