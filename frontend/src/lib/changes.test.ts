import { describe, expect, it } from "vitest";

import { diffLines, readChanges, totals } from "./changes";

const TREE = "a".repeat(40);

describe("a code step's changes", () => {
  it("are read from the backend's event, dropping what isn't a file change", () => {
    const value = JSON.stringify({ before: TREE, after: TREE, files: [{ path: "theme.ts", status: "modified", additions: 2, deletions: 1 }, { path: "logo.png", status: "added", additions: null, deletions: null }, { path: 3, status: "added" }, { path: "x", status: "renamed" }] });
    expect(readChanges(value)?.files.map((f) => f.path)).toEqual(["theme.ts", "logo.png"]);
    expect(readChanges(JSON.stringify({ before: TREE, after: TREE, files: [] }))).toBeNull();
    expect(readChanges("not json")).toBeNull();
    expect(readChanges(JSON.stringify({ files: [] }))).toBeNull();
  });

  it("add up, with binary files counting no lines", () => {
    const changes = readChanges(JSON.stringify({ before: TREE, after: TREE, files: [{ path: "a", status: "modified", additions: 2, deletions: 1 }, { path: "b.png", status: "added", additions: null, deletions: null }, { path: "c", status: "deleted", additions: 0, deletions: 5 }] }))!;
    expect(totals(changes)).toEqual({ additions: 2, deletions: 6 });
  });

  it("show a file's diff from its first hunk, and cut a long one", () => {
    const diff = "diff --git a/t.ts b/t.ts\nindex 1..2 100644\n--- a/t.ts\n+++ b/t.ts\n@@ -1 +1,2 @@\n-light\n+dark\n+auto\n same\n";
    expect(diffLines(diff).lines.map((l) => l.kind)).toEqual(["hunk", "remove", "add", "add", "same"]);
    const long = `@@ -1 +1 @@\n${"+x\n".repeat(10)}`;
    expect(diffLines(long, 4)).toMatchObject({ cut: true, lines: { length: 4 } });
    expect(diffLines("Binary files a/logo.png and b/logo.png differ\n").lines).toEqual([{ kind: "same", text: "Binary files a/logo.png and b/logo.png differ" }]);
  });
});
