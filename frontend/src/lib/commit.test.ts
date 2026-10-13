import { describe, expect, it } from "vitest";

import { commitMessage } from "./commit";

describe("a CLI's reply as a commit message", () => {
  it("keeps a clean subject and body as they are", () => {
    expect(commitMessage("Add the pricing page\n\nVisitors asked what it costs.")).toBe("Add the pricing page\n\nVisitors asked what it costs.");
  });

  it("takes off fences, labels and quotes", () => {
    expect(commitMessage('```\nCommit message: "Fix the signup form"\n```')).toBe("Fix the signup form");
  });

  it("keeps the subject under 72 characters", () => {
    const said = commitMessage("Make every page of the website load faster by lazy loading the images below the fold")!;
    expect(said.length).toBeLessThanOrEqual(72);
    expect(said.endsWith("…")).toBe(true);
  });

  it("is nothing when the reply is empty", () => {
    expect(commitMessage("  \n ")).toBeNull();
  });
});
