import { describe, expect, it } from "vitest";

import { editLines, readEdit } from "./linediff";

describe("a live edit", () => {
  it("marks what changed and keeps what didn't", () => {
    expect(editLines("line one\nline two\nline three", "line one\nline 2\nline three").map((l) => l.text)).toEqual([" line one", "-line two", "+line 2", " line three"]);
  });

  it("shows a new file as all added", () => {
    expect(editLines("", "a\nb")).toEqual([{ kind: "add", text: "+a" }, { kind: "add", text: "+b" }]);
  });

  it("falls back to all out, all in for very long edits", () => {
    const long = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n");
    const lines = editLines(long, "x");
    expect(lines.filter((l) => l.kind === "remove")).toHaveLength(500);
    expect(lines[lines.length - 1]).toEqual({ kind: "add", text: "+x" });
  });

  it("is read from the backend's event, or dropped", () => {
    expect(readEdit(JSON.stringify({ path: "a.ts", before: "", after: "x" }))).toEqual({ path: "a.ts", before: "", after: "x" });
    expect(readEdit(JSON.stringify({ path: "a.ts" }))).toBeNull();
    expect(readEdit("nope")).toBeNull();
  });
});
