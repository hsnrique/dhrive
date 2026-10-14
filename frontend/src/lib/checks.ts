import type { CheckReport } from "@/lib/api";

// What dhrive makes of its own checks of a delivery (checks.rs): whether the task is done, what to
// tell the agent when it isn't, and what the task says once it's over. A delivery that fails goes
// back to its agent up to FIX_ATTEMPTS times before the task is marked failed.

export const FIX_ATTEMPTS = 2;

export const passed = (report: CheckReport) => report.kind === "skipped" || (report.checks.every((c) => c.ok) && report.missing.length === 0);

// The checks that failed, then the scripts the project doesn't have.
export function failing(report: CheckReport): string[] {
  if (report.kind === "skipped") return [];
  return [...report.checks.filter((c) => !c.ok).map((c) => c.name), ...report.missing.map((name) => `${name} (missing)`)];
}

export function fixPrompt(report: CheckReport, title: string): string {
  if (report.kind === "skipped") return "";
  const broken = report.checks.filter((c) => !c.ok);
  const failed = broken.map((c) => `## ${c.name}\n\n${c.tail || "(it printed nothing)"}`);
  const rerun = broken.length ? `${broken.map((c) => c.name).join(", ")} again until ${broken.length === 1 ? "it passes" : "they pass"}` : "the checks again until they pass";
  const missing = report.missing.length ? [`## Missing scripts\n\npackage.json has no ${report.missing.join(", ")}. Add them: typecheck is tsc --noEmit, test is vitest run.`] : [];
  return [
    `dhrive ran this project's checks after your task "${title}", and they didn't all pass.`,
    ...failed,
    ...missing,
    // dhrive runs all four again after the fix, so the agent reruns only what failed: a build it already
    // passed would only fill its context with output.
    `Fix the cause in the code. Never weaken, skip or delete a check, a lint rule or a test to make it pass. Then run ${rerun}, and say what you fixed; dhrive runs all four after you.`,
  ].join("\n\n");
}

// Said after the agent's own summary of a done task: what dhrive itself checked.
export function verdict(report: CheckReport, fixes: number): string {
  if (report.kind === "skipped") return "";
  const ran = report.checks.map((c) => c.name).join(", ");
  return `\n\nChecks passed${fixes ? ` after ${fixes} ${fixes === 1 ? "fix" : "fixes"}` : ""}: ${ran}.`;
}

// A failed task's result: which checks didn't pass, and what the first of them said.
export function failure(report: CheckReport): string {
  const first = report.kind === "ran" ? report.checks.find((c) => !c.ok) : undefined;
  return [`Didn't pass dhrive's checks: ${failing(report).join(", ")}.`, first?.tail].filter(Boolean).join("\n\n");
}
