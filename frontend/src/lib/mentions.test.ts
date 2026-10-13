import { describe, expect, it } from "vitest";

import { indexFiles, insertMention, mentionAt, resolvePath, segments, suggest } from "./mentions";

const index = indexFiles(["README.md", "src/theme.ts", "src/components/Header.tsx", "src/components/Footer.tsx", "docs/Header.tsx"]);

describe("mentions", () => {
  it("resolve what a model writes: paths, folders, line numbers and unique names", () => {
    expect(resolvePath("src/theme.ts", index)).toBe("src/theme.ts");
    expect(resolvePath("./src/theme.ts:42:7", index)).toBe("src/theme.ts");
    expect(resolvePath("src/theme.ts#L10-L20", index)).toBe("src/theme.ts");
    expect(resolvePath("src/components", index)).toBe("src/components/");
    expect(resolvePath("theme.ts", index)).toBe("src/theme.ts");
    expect(resolvePath("Header.tsx", index)).toBeNull();
    expect(resolvePath("npm test", index)).toBeNull();
    expect(resolvePath("useTheme()", index)).toBeNull();
  });

  it("find the @query right before the caret", () => {
    expect(mentionAt("look at @src/th", 15)).toEqual({ start: 8, query: "src/th" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionAt("mail a@b.com", 12)).toBeNull();
    expect(mentionAt("@src done", 9)).toBeNull();
  });

  it("suggest name matches first, then paths, then the name's letters in order", () => {
    expect(suggest(index, "head")).toEqual(["docs/Header.tsx", "src/components/Header.tsx"]);
    expect(suggest(index, "comp")[0]).toBe("src/components/");
    expect(suggest(index, "thts")).toEqual(["src/theme.ts"]);
    expect(suggest(index, "sct")).toEqual([]);
    expect(suggest(index, "")).toEqual(["src/", "docs/", "README.md"]);
    expect(suggest(index, "zzz")).toEqual([]);
  });

  it("insert the picked path in place of what was typed", () => {
    expect(insertMention("fix @hea please", 4, 8, "src/components/Header.tsx")).toEqual({ text: "fix @src/components/Header.tsx please", caret: 31 });
    expect(insertMention("@th", 0, 3, "src/theme.ts")).toEqual({ text: "@src/theme.ts ", caret: 14 });
  });

  it("pick the owner's mentions out of a message, leaving trailing punctuation as text", () => {
    expect(segments("why is @src/theme.ts, and @nope slow?", index)).toEqual([
      { kind: "text", text: "why is " },
      { kind: "mention", text: "@src/theme.ts", path: "src/theme.ts" },
      { kind: "text", text: "," },
      { kind: "text", text: " and " },
      { kind: "text", text: "@nope" },
      { kind: "text", text: " slow?" },
    ]);
  });
});
