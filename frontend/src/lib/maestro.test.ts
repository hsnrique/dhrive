import { describe, expect, it } from "vitest";

import { MAX_PARTS, MAX_PROMPT, parseSplit, savedParts, withFocus } from "./maestro";

const all = ["claude-code", "codex", "antigravity"] as const;

describe("reading the maestro's split", () => {
  it("reads the array out of a fenced reply and maps each CLI name", () => {
    const reply = 'Here you go:\n```json\n[{"title":"API","cli":"codex","prompt":"Add the route"},{"title":"UI","cli":"Claude","prompt":"Add the page"},{"title":"Docs","cli":"agy","prompt":"Document it"}]\n```';
    expect(parseSplit(reply, [...all], "claude-code").map(({ title, engine, prompt }) => ({ title, engine, prompt }))).toEqual([
      { title: "API", engine: "codex", prompt: "Add the route" },
      { title: "UI", engine: "claude-code", prompt: "Add the page" },
      { title: "Docs", engine: "antigravity", prompt: "Document it" },
    ]);
  });

  it("sends a CLI that isn't installed, or unknown, to the maestro's own", () => {
    const reply = '[{"title":"a","cli":"antigravity","prompt":"x"},{"title":"b","cli":"gemini","prompt":"y"}]';
    expect(parseSplit(reply, ["claude-code", "codex"], "codex").map((p) => p.engine)).toEqual(["codex", "codex"]);
  });

  it("drops subtasks without a usable prompt, names untitled ones, and keeps at most six", () => {
    const items = [{ cli: "codex", prompt: "  fix it  " }, { title: "empty", prompt: " " }, { title: "huge", prompt: "x".repeat(MAX_PROMPT + 1) }, { title: 3, prompt: 4 }, null, "text"];
    const parts = parseSplit(JSON.stringify(items), [...all], "claude-code");
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ title: "fix it", prompt: "fix it" });
    const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, cli: "codex", prompt: `p${i}` })));
    expect(parseSplit(many, [...all], "codex")).toHaveLength(MAX_PARTS);
  });

  it("gives nothing for a reply that holds no array", () => {
    for (const reply of ["I can't split this.", "[not json]", '{"title":"a"}', ""]) expect(parseSplit(reply, [...all], "codex")).toEqual([]);
  });
});

describe("what the maestro keeps and is asked to use", () => {
  it("brings back saved subtasks that still look like subtasks", () => {
    const good = { id: "a", title: "API", engine: "codex", model: "", prompt: "Add the route" };
    expect(savedParts([good, { ...good, prompt: 3 }, null, "x"])).toEqual([good]);
    expect(savedParts("nope")).toEqual([]);
  });

  it("names the picked skills, servers and plugins under the brief, and leaves a brief without any alone", () => {
    expect(withFocus(" build it ", [])).toBe(" build it ");
    const asked = withFocus("build it", [{ kind: "server", name: "github" }, { kind: "skill", name: "frontend-design" }, { kind: "skill", name: "tdd" }]);
    expect(asked.startsWith("build it\n\nUse these where they help")).toBe(true);
    expect(asked.endsWith("Skills: frontend-design, tdd\nMCP servers: github")).toBe(true);
  });
});
