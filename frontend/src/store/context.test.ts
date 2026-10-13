import { describe, expect, it, vi } from "vitest";

import type { ContextUsage, SessionRef } from "@/lib/api";

// Every call stays pending until the test settles it, so reads and compactions end in any order.
type Call = { kind: "read" | "compact"; key: string; resolve: (value: ContextUsage | null) => void; reject: (error: Error) => void };
const pending: Call[] = [];
// A read asked for while its session is being compacted would break the rule the store keeps.
let readDuringCompaction = false;
const call = (kind: Call["kind"]) => (s: SessionRef) =>
  new Promise((resolve, reject) => {
    const key = `${s.engine}:${s.session}`;
    if (kind === "read" && pending.some((c) => c.key === key && c.kind === "compact")) readDuringCompaction = true;
    pending.push({ kind, key, resolve, reject });
  });

vi.mock("@/lib/api", () => ({ contextUsage: vi.fn(call("read")), compactSession: vi.fn(call("compact")) }));

const { useContextUsage, compactionOf } = await import("./context");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const prng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const usage = (used: number): ContextUsage => ({ used, max: 200_000, parts: [], autoCompactAt: null });
const SESSIONS: SessionRef[] = [{ engine: "claude-code", session: "s-1", folder: "/a" }, { engine: "codex", session: "t-1", folder: "/a" }];

describe("a conversation's context", () => {
  it("never reads or compacts one session twice at once, and never starts a read while compacting", async () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = prng(seed);
      pending.length = 0;
      readDuringCompaction = false;
      useContextUsage.setState({ seen: {} });
      for (let step = 0; step < 30; step++) {
        const session = SESSIONS[Math.floor(random() * SESSIONS.length)];
        const roll = random();
        if (roll < 0.35) void useContextUsage.getState().read(session);
        else if (roll < 0.55) void useContextUsage.getState().compact(session);
        else if (pending.length > 0) {
          const settled = pending.splice(Math.floor(random() * pending.length), 1)[0];
          if (random() < 0.8) settled.resolve(settled.kind === "compact" && settled.key.startsWith("codex") ? null : usage(step));
          else settled.reject(new Error("Not enough messages to compact."));
          await flush();
        }
        for (const s of SESSIONS) {
          const key = `${s.engine}:${s.session}`;
          const mine = pending.filter((c) => c.key === key);
          expect(mine.filter((c) => c.kind === "compact").length, `seed ${seed}: one compaction at a time`).toBeLessThanOrEqual(1);
          expect(mine.filter((c) => c.kind === "read").length, `seed ${seed}: one read at a time`).toBeLessThanOrEqual(1);
          expect(readDuringCompaction, `seed ${seed}: no read starts while compacting`).toBe(false);
          expect(Boolean(compactionOf(s.engine, s.session)), `seed ${seed}`).toBe(mine.some((c) => c.kind === "compact"));
        }
      }
      while (pending.length) {
        pending.shift()!.resolve(usage(1));
        await flush();
      }
      await flush();
      for (const s of SESSIONS) expect(useContextUsage.getState().seen[`${s.engine}:${s.session}`]?.compacting ?? false, `seed ${seed}`).toBe(false);
    }
  });

  it("a read that started before a compaction doesn't replace the compacted size", async () => {
    pending.length = 0;
    useContextUsage.setState({ seen: {} });
    const [session] = SESSIONS;
    void useContextUsage.getState().read(session);
    void useContextUsage.getState().compact(session);
    const [read, compaction] = pending.splice(0);
    compaction.resolve(usage(12_000));
    await flush();
    read.resolve(usage(180_000));
    await flush();
    expect(useContextUsage.getState().seen["claude-code:s-1"]).toMatchObject({ value: { used: 12_000 }, note: "Compacted.", reading: false, compacting: false });
  });
});
