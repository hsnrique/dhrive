import { beforeEach, describe, expect, it, vi } from "vitest";

import { readDraft, writeDraft } from "./drafts";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });

describe("drafts", () => {
  beforeEach(() => store.clear());

  it("keep what was typed per conversation, and forget it once it's empty", () => {
    writeDraft("c1", "half a thought");
    writeDraft("c2", "another");
    expect([readDraft("c1"), readDraft("c2"), readDraft("c3")]).toEqual(["half a thought", "another", ""]);
    writeDraft("c1", "  ");
    expect(readDraft("c1")).toBe("");
  });

  it("keep only the most recent fifty", () => {
    for (let i = 0; i < 60; i++) writeDraft(`c${i}`, `draft ${i}`);
    expect(readDraft("c0")).toBe("");
    expect(readDraft("c59")).toBe("draft 59");
    expect(Object.keys(JSON.parse(store.get("dhrive.drafts")!))).toHaveLength(50);
  });
});
