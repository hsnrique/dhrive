import { describe, expect, it } from "vitest";

import { highlight, languageOf, type Token } from "./highlight";

const kinds = (line: Token[]) => line.filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.text}`);

describe("syntax coloring", () => {
  it("knows a file's language by its name", () => {
    expect(languageOf("src/components/Header.tsx")).toBe("js");
    expect(languageOf("src-tauri/src/lib.rs")).toBe("rust");
    expect(languageOf("Dockerfile")).toBe("shell");
    expect(languageOf("notes.txt")).toBeNull();
  });

  it("colors comments, strings, numbers and keywords", () => {
    const [line] = highlight('const port = 1420; // dev server "only"', "js");
    expect(kinds(line)).toEqual(["keyword:const", "number:1420", 'comment:// dev server "only"']);
    const [rust] = highlight('pub fn main() { let x = "a"; }', "rust");
    expect(kinds(rust)).toEqual(["keyword:pub", "keyword:fn", "keyword:let", 'string:"a"']);
  });

  it("doesn't color a keyword inside a longer name", () => {
    expect(kinds(highlight("constant = format + ifx", "js")[0])).toEqual([]);
  });

  it("keeps a block comment spanning lines colored on each line", () => {
    const lines = highlight("/* one\ntwo */ let a = 1", "js");
    expect(lines.map(kinds)).toEqual([["comment:/* one"], ["comment:two */", "keyword:let", "number:1"]]);
  });

  it("leaves text it doesn't know as it is, line by line", () => {
    expect(highlight("a\n\nb", null)).toEqual([[{ kind: "plain", text: "a" }], [], [{ kind: "plain", text: "b" }]]);
  });
});
