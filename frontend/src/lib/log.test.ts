import { describe, expect, it } from "vitest";

import { entry, news, parseReply, savedLog } from "./log";

const AGENT = { engine: "claude-code" as const, model: "sonnet" };

describe("a company's timeline", () => {
  it("splits a reply into what it says and the tasks it suggests", () => {
    const reply = 'Signups are flat.\n\n```tasks\n[{"title": "Pricing page", "area": "code", "prompt": "Add a pricing page"}]\n```\n';
    const { text, tasks } = parseReply(reply, AGENT);
    expect(text).toBe("Signups are flat.");
    expect(tasks.map((t) => [t.title, t.engine])).toEqual([["Pricing page", "claude-code"]]);
    expect(parseReply("All good [really].", AGENT)).toEqual({ text: "All good [really].", tasks: [] });
  });

  it("tells the agent only what happened since it last spoke", () => {
    const log = [entry("done", "Old task"), entry("agent", "ok"), entry("owner", "hi"), entry("done", "Landing page"), entry("published", "https://acme.dhrive.site")];
    expect(news(log)).toBe("What happened since we last spoke:\n- Done: Landing page\n- Published: https://acme.dhrive.site");
    expect(news([entry("agent", "ok")])).toBe("");
  });

  it("brings saved entries back only if they look like entries", () => {
    const good = entry("owner", "hi");
    expect(savedLog([good, { id: "x", kind: "nope", at: 1, text: "" }, null])).toEqual([good]);
    expect(savedLog("nope")).toEqual([]);
  });
});
