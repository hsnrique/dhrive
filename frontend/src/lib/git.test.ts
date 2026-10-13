import { describe, expect, it } from "vitest";

import { branchName, commitMessage } from "./git";

describe("a step's commit", () => {
  it("takes its message from the request's first line", () => {
    expect(commitMessage("\n  add retries with backoff\nto the webhook sender")).toBe("Add retries with backoff");
    expect([...commitMessage("x".repeat(100))].length).toBe(72);
    expect(commitMessage("   ")).toBe("");
    expect(commitMessage("Add a toggle and remember the choice.")).toBe("Add a toggle and remember the choice");
  });

  it("names a branch git accepts, from the request's words", () => {
    expect(branchName("Adicionar retries ao webhook! (urgente)")).toBe("dhrive/adicionar-retries-ao-webhook-urgente");
    expect(branchName("Make the whole checkout flow faster on Safari and Firefox please")).toBe("dhrive/make-the-whole-checkout-flow-faster-on");
    expect(branchName("🚀 !!!")).toBe("dhrive/change");
  });
});
