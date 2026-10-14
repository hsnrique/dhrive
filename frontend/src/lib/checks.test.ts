import { describe, expect, it } from "vitest";

import type { CheckReport } from "@/lib/api";
import { failing, failure, fixPrompt, passed, verdict } from "./checks";

const ran = (checks: [string, boolean, string?][], missing: string[] = []): CheckReport => ({ kind: "ran", checks: checks.map(([name, ok, tail = ""]) => ({ name, ok, tail })), missing });
const ALL = ran([["lint", true], ["typecheck", true], ["test", true], ["build", true]]);

describe("dhrive's checks of a delivery", () => {
  it("passes only when every check ran and passed, or there was nothing to check", () => {
    expect(passed(ALL)).toBe(true);
    expect(passed({ kind: "skipped", why: "Only documents changed." })).toBe(true);
    expect(passed(ran([["lint", true], ["test", false]]))).toBe(false);
    expect(passed(ran([["lint", true]], ["typecheck"])), "a script the standard keeps is missing").toBe(false);
  });

  it("tells the agent what failed, in its own words, not to weaken the checks, and to rerun only those", () => {
    const prompt = fixPrompt(ran([["lint", true], ["test", false, "expected 2, got 3"]], ["build"]), "Signup");
    expect(prompt).toContain('your task "Signup"');
    expect(prompt).toContain("## test\n\nexpected 2, got 3");
    expect(prompt).not.toContain("## lint");
    expect(prompt).toContain("package.json has no build");
    expect(prompt).toContain("Never weaken, skip or delete a check");
    expect(prompt, "only what failed is rerun; dhrive reruns the rest").toContain("Then run test again until it passes, and say what you fixed; dhrive runs all four after you.");
  });

  it("says what it checked on a done task, and what failed on a failed one", () => {
    expect(verdict(ALL, 0)).toBe("\n\nChecks passed: lint, typecheck, test, build.");
    expect(verdict(ALL, 1)).toBe("\n\nChecks passed after 1 fix: lint, typecheck, test, build.");
    expect(verdict({ kind: "skipped", why: "x" }, 0)).toBe("");
    const report = ran([["lint", true], ["test", false, "expected 2, got 3"]], ["build"]);
    expect(failing(report)).toEqual(["test", "build (missing)"]);
    expect(failure(report)).toBe("Didn't pass dhrive's checks: test, build (missing).\n\nexpected 2, got 3");
  });
});
