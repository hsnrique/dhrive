import { describe, expect, it } from "vitest";

import { newAgent } from "./army";
import { MAX_KEPT, MAX_TASKS, alreadyNote, ownTask, parseDay, savedTasks, standing, taskPrompt, taskSummary, trimmed, type Task } from "./day";

const AGENT = { engine: "claude-code" as const, model: "sonnet" };

describe("a company's day", () => {
  it("reads the planned tasks from a fenced reply, each for the owner's agent whatever the plan says", () => {
    const reply = 'Plan:\n```json\n[{"title": "Ad copy", "area": "Marketing", "cli": "codex", "prompt": "Write three ads"}, {"title": "Fix", "area": "nope", "prompt": "Fix the form"}, {"title": "x", "prompt": ""}]\n```';
    const tasks = parseDay(reply, AGENT);
    expect(tasks.map((t) => [t.title, t.area, t.engine, t.model, t.status])).toEqual([
      ["Ad copy", "marketing", "claude-code", "sonnet", "planned"],
      ["Fix", "code", "claude-code", "sonnet", "planned"],
    ]);
    expect(parseDay("no plan", AGENT)).toEqual([]);
  });

  it("gives each task to the army's agent the planner named, on that agent's CLI, else to the company's", () => {
    const back = newAgent("Back", "APIs", { engine: "codex", model: "gpt-6" })!;
    const reply = JSON.stringify([
      { title: "API", area: "code", agent: "back", prompt: "Add the billing API" },
      { title: "Post", area: "marketing", agent: "Nobody", prompt: "Draft a post" },
    ]);
    const [api, post] = parseDay(reply, AGENT, [back]);
    expect([api.agentId, api.engine, api.model]).toEqual([back.id, "codex", "gpt-6"]);
    expect([post.agentId, post.engine, post.model]).toEqual([undefined, "claude-code", "sonnet"]);
    expect(taskPrompt(api, "planilha.", back)).toMatch(/^You are Back, one of planilha\.'s agents\. Your role: APIs\n\nAdd the billing API/);
    expect(savedTasks([{ ...api, agentId: 3 }, api]).map((t) => t.agentId)).toEqual([undefined, back.id]);
  });

  it("keeps at most a day's worth of tasks", () => {
    const many = JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, area: "code", cli: "claude", prompt: "do it" })));
    expect(parseDay(many, AGENT)).toHaveLength(MAX_TASKS);
  });

  it("tells each task's agent whose company it works for, and never to reach the outside world", () => {
    const [task] = parseDay('[{"title": "Post", "area": "marketing", "prompt": "Draft a post"}]', AGENT);
    const prompt = taskPrompt(task, "planilha.");
    expect(prompt.startsWith("Draft a post")).toBe(true);
    expect(prompt).toContain("tasks of planilha.");
    expect(prompt).toContain("docs/design-guide.md");
    expect(prompt).toContain("Don't publish, post, send, buy or spend anything");
    expect(prompt).toContain("Next.js (the latest release)");
    expect(prompt).toContain("Pin every dependency to an exact version");
  });

  it("holds every task to the engineering standard, ending on the checks dhrive runs", () => {
    const [task] = parseDay('[{"title": "Signup", "area": "code", "prompt": "Build the signup"}]', AGENT);
    const prompt = taskPrompt(task, "planilha.");
    expect(prompt).toContain("Keep three layers apart");
    expect(prompt).toContain("docs/architecture.md");
    expect(prompt).toContain("Tests come with the code");
    expect(prompt).toContain("package.json keeps the scripts lint, typecheck, test, build");
    expect(prompt.indexOf("Work to this engineering standard")).toBeLessThan(prompt.indexOf("Don't publish"));
  });

  it("brings saved tasks back, a cut-off one as stopped", () => {
    const [task] = parseDay('[{"title": "A", "area": "code", "prompt": "a"}]', AGENT);
    const saved = savedTasks([{ ...task, status: "running", runId: "r1" }, { title: "broken" }, "nope"]);
    expect(saved).toEqual([{ ...task, status: "stopped", runId: null }]);
    expect(savedTasks(null)).toEqual([]);
  });
});

describe("the company's backlog", () => {
  const one = (status: string, title = "A") => ({ ...parseDay(`[{"title": "${title}", "prompt": "a"}]`, AGENT)[0], status }) as ReturnType<typeof parseDay>[number];

  it("titles the owner's task by its first line", () => {
    expect(ownTask("Ship a pricing page\nthree plans", "code", AGENT)).toMatchObject({ title: "Ship a pricing page", prompt: "Ship a pricing page\nthree plans", status: "planned" });
    expect(ownTask("x".repeat(100), "research", AGENT)?.title).toHaveLength(80);
    expect(ownTask("  ", "code", AGENT)).toBeNull();
  });

  it("drops the oldest finished tasks first, never open ones", () => {
    const tasks = [one("planned"), ...Array.from({ length: MAX_KEPT }, () => one("done"))];
    const kept = trimmed(tasks);
    expect(kept).toHaveLength(MAX_KEPT);
    expect(kept[0].status).toBe("planned");
  });

  it("tells the agent what's done and queued so it suggests something new", () => {
    expect(alreadyNote([one("done", "Ads"), one("planned", "Form"), one("suggested", "Blog")])).toBe("Already done:\n- Ads\n\nAlready queued:\n- Form");
    expect(alreadyNote([])).toBe("");
  });
});

describe("where the company stands", () => {
  const task = (status: string) => ({ ...parseDay('[{"title": "A", "prompt": "a"}]', AGENT)[0], status }) as ReturnType<typeof parseDay>[number];
  it("says what's happening in a line", () => {
    expect(standing([task("done"), task("running"), task("planned")], true)).toEqual({ live: true, text: "Working on its first delivery · 1 of 3 done" });
    expect(standing([task("done"), task("done")], true).text).toBe("First delivery done");
    expect(standing([task("done"), task("running"), task("planned")], false).text).toBe("Working · 1 up next");
    expect(standing([task("running"), task("running"), task("running"), task("planned")], false).text, "an army says how many work at once").toBe("3 working · 1 up next");
    expect(standing([task("done"), task("stopped"), task("planned")], false).text).toBe("1 task up next");
    expect(standing([task("suggested"), task("suggested")], false).text).toBe("2 suggested tasks to look over");
    expect(standing([], false).text).toBe("Resting");
  });
});

describe("taskSummary", () => {
  const task = (change: Partial<Task>): Task => ({ id: "t", title: "Pricing page", area: "code", engine: "claude-code", model: "", prompt: "Pricing page", status: "planned", runId: null, result: "", ...change });

  it("says what a waiting task asks beyond its title, and what a finished one did, in one plain line", () => {
    expect(taskSummary(task({ prompt: "Pricing page\nTwo plans, yearly first." }))).toBe("Two plans, yearly first.");
    expect(taskSummary(task({})), "nothing beyond the title").toBe("");
    expect(taskSummary(task({ status: "done", result: "## Done\n\n- **Added** `pricing.tsx`" }))).toBe("Done");
    expect(taskSummary(task({ status: "failed", result: "\n  > Build failed: Type error" }))).toBe("Build failed: Type error");
  });
});
