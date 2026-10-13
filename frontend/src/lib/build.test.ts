import { describe, expect, it } from "vitest";

import { buildFailure, fixPrompt, headline } from "./build";

describe("a failed build", () => {
  it("is told apart from other failures, with the build's output", () => {
    expect(buildFailure("Error: The website didn't build:\nType error in page.tsx")).toBe("Type error in page.tsx");
    expect(buildFailure("Couldn't reach dhrive's site host.")).toBeNull();
  });

  it("is named by the line that says what broke", () => {
    expect(headline("./app/page.tsx:42:7\nType error: Property 'rows' does not exist\n  at x")).toBe("Type error: Property 'rows' does not exist");
    expect(headline("Exporting...\nExit 1")).toBe("Exit 1");
    expect(headline("")).toBe("the website didn't build");
  });

  it("becomes a task that carries the output and the bar to finish", () => {
    const prompt = fixPrompt("Type error in page.tsx");
    expect(prompt.split("\n")[0]).toBe("Fix the website's build");
    expect(prompt).toContain("Type error in page.tsx");
    expect(prompt).toContain("without removing features");
  });
});
