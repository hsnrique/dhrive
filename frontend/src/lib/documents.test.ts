import { describe, expect, it } from "vitest";

import { ownTask } from "./day";
import { DOCUMENTS, documentPrompt, missing, preview, writtenOf } from "./documents";

describe("a company's documents", () => {
  it("lists the ones not written yet, in order", () => {
    expect(missing({ mission: "# Mission", roadmap: null }).map((k) => k.id)).toEqual(["roadmap", "design-guide", "market-research"]);
  });

  it("asks for each as a task titled by what it writes, at its own path", () => {
    const research = DOCUMENTS.find((k) => k.id === "market-research")!;
    const task = ownTask(documentPrompt(research), research.area, { engine: "claude-code", model: "" });
    expect(task?.title).toBe("Write the market research");
    expect(task?.prompt).toContain("Write docs/market-research.md:");
    expect(task?.area).toBe("research");
  });

  it("is known by its first line of prose", () => {
    expect(preview("# Mission\n\n---\n- **Help** people [budget](https://x.y) in `minutes`.\nMore.")).toBe("Help people budget in minutes.");
    expect(preview("# Only a title")).toBe("");
  });
  it("counts as missing only what isn't there: one that can't be read is never written over", () => {
    const written = writtenOf([{ id: "mission", text: "# Mission" }, { id: "roadmap", text: null }, { id: "design-guide", text: null, unreadable: true }]);
    expect(written["design-guide"]).toBe(false);
    expect(missing(written).map((k) => k.id)).toEqual(["roadmap", "market-research"]);
  });
});
