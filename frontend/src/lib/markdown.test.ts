import { describe, expect, it } from "vitest";

import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("reads the headings, lists, code and paragraphs a plan is made of", () => {
    const plan = "## Plan\nTouch two files.\n\n1. Add **toggle** in `App.tsx`\n2. Persist it\n- risk: flash\n\n```ts\nconst a = 1;\n```";
    expect(parseMarkdown(plan)).toEqual([
      { kind: "heading", level: 2, inlines: [{ kind: "text", text: "Plan" }] },
      { kind: "paragraph", inlines: [{ kind: "text", text: "Touch two files." }] },
      {
        kind: "list",
        ordered: true,
        items: [
          [{ kind: "text", text: "Add " }, { kind: "strong", text: "toggle" }, { kind: "text", text: " in " }, { kind: "code", text: "App.tsx" }],
          [{ kind: "text", text: "Persist it" }],
        ],
      },
      { kind: "list", ordered: false, items: [[{ kind: "text", text: "risk: flash" }]] },
      { kind: "code", text: "const a = 1;" },
    ]);
  });

  it("keeps code bold inside bold text", () => {
    expect(parseInline("**`src/theme.ts`**: add **the `useTheme()` hook**")).toEqual([
      { kind: "code", text: "src/theme.ts", strong: true },
      { kind: "text", text: ": add " },
      { kind: "strong", text: "the " },
      { kind: "code", text: "useTheme()", strong: true },
      { kind: "strong", text: " hook" },
    ]);
  });

  it("keeps markup-looking text as plain text, never as HTML", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
  });

  it("reads links, with a plain or an angle-bracketed target, between other text", () => {
    expect(parseInline("See [the survey](https://rtb.ie/a.pdf) and [**notes**](</Users/ana/my co/notes.md>).")).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", text: "the survey", href: "https://rtb.ie/a.pdf" },
      { kind: "text", text: " and " },
      { kind: "link", text: "notes", href: "/Users/ana/my co/notes.md" },
      { kind: "text", text: "." },
    ]);
    expect(parseInline("[not a link] (x)")).toEqual([{ kind: "text", text: "[not a link] (x)" }]);
  });

  it("an unclosed code fence runs to the end instead of swallowing nothing", () => {
    expect(parseMarkdown("```\nlet x")).toEqual([{ kind: "code", text: "let x" }]);
  });
});
