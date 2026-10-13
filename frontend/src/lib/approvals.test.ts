import { describe, expect, it } from "vitest";

import { asking, readQuestion, ruleLabel } from "./approvals";

describe("permission questions", () => {
  it("are read from the backend's event, or dropped", () => {
    const value = JSON.stringify({ id: "q1", tool: "Bash", detail: "npm test", description: "Run the tests", rule: "Bash(npm test:*)" });
    expect(readQuestion(value)).toEqual({ id: "q1", tool: "Bash", detail: "npm test", description: "Run the tests", rule: "Bash(npm test:*)" });
    expect(readQuestion(JSON.stringify({ id: "q2", tool: "WebFetch", rule: "" }))?.rule).toBeNull();
    expect(readQuestion("{}")).toBeNull();
    expect(readQuestion("nope")).toBeNull();
  });

  it("say what the model wants in plain words", () => {
    expect(asking({ id: "", tool: "Bash", detail: "", description: "", rule: null })).toBe("wants to run");
    expect(asking({ id: "", tool: "mcp__linear__create_issue", detail: "", description: "", rule: null })).toBe("wants to use mcp__linear__create_issue");
    expect(ruleLabel("Bash(npm test:*)")).toBe("npm test…");
    expect(ruleLabel("Bash(echo hello *)")).toBe("echo hello…");
    expect(ruleLabel("WebFetch(domain:docs.stripe.com)")).toBe("docs.stripe.com");
    expect(ruleLabel("WebSearch")).toBe("WebSearch");
  });
});
