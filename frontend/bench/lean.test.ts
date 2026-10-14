import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { taskPrompt, type Task } from "@/lib/day";

// The lean bench: the same company tasks on the real CLIs, with Lean on and off, run the way dhrive
// runs a task left alone (the same flags), then dhrive's four checks. What each run spent comes from
// the CLI's own report. It spends the owner's plan, so it runs only when asked:
//   DHRIVE_BENCH=1 npx vitest run bench/lean.test.ts
// DHRIVE_BENCH_CLIS=claude,codex, DHRIVE_BENCH_TASKS=4 and DHRIVE_BENCH_REPEATS=2 choose what runs.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const MODULES = join(HERE, "../node_modules");
const CHECKS = ["lint", "typecheck", "test", "build"];
const TASKS = [
  ["Slug helper", "Add slugify(title) in src/slug.ts: lowercase, strip accents, collapse anything that isn't a letter or a digit into single dashes, no dashes at either end. Test it in src/slug.test.ts."],
  ["Cart total", "Customers who buy more than one of an item are undercharged at checkout. Find the cause in src/cart.ts and fix it, with a test that fails without the fix."],
  ["Signup validation", "createUser in src/users.ts accepts empty names and malformed emails. Make it reject both with clear errors, and test it."],
  ["Monthly report", "Add summarize(orders) in src/report.ts: the total in cents per month (YYYY-MM), sorted by month, from the orders in src/orders.ts. Test it."],
];

interface Run { cli: string; task: string; lean: boolean; input: number; cached: number; output: number; cost: number | null; seconds: number; said: number; changed: boolean; passed: string[]; failed?: string }

const exec = (cmd: string, args: string[], cwd: string, ms: number) =>
  new Promise<{ out: string; code: number | null }>((done) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), ms);
    child.on("close", (code) => (clearTimeout(timer), done({ out, code })));
  });

// A fresh copy of the fixture, as its own git repo, sharing dhrive's node_modules.
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "dhrive-bench-"));
  cpSync(join(HERE, "fixture"), dir, { recursive: true });
  symlinkSync(MODULES, join(dir, "node_modules"));
  writeFileSync(join(dir, ".gitignore"), "node_modules\ndist\n.cache\n");
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "bench", GIT_AUTHOR_EMAIL: "bench@dhrive.test", GIT_COMMITTER_NAME: "bench", GIT_COMMITTER_EMAIL: "bench@dhrive.test" } });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "Tally");
  return dir;
}

// The flags dhrive gives a code step left alone (engine/command.rs), with the prompt as an argument.
const COMMANDS: Record<string, (prompt: string) => [string, string[]]> = {
  claude: (prompt) => ["claude", ["-p", prompt, "--output-format", "json", "--permission-mode", "bypassPermissions", "--allowedTools", "Read,Glob,Grep,WebSearch,Edit,Write,Bash", "--strict-mcp-config", "--model", "sonnet"]],
  codex: (prompt) => ["codex", ["exec", "--skip-git-repo-check", "--json", "-c", "mcp_servers={}", "-c", 'model_reasoning_effort="medium"', "--sandbox", "workspace-write", "--", prompt]],
};

function usageOf(cli: string, out: string): Pick<Run, "input" | "cached" | "output" | "cost" | "said"> {
  if (cli === "claude") {
    const r = JSON.parse(out.slice(out.indexOf("{")));
    const u = r.usage ?? {};
    return { input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens ?? 0, cost: r.total_cost_usd ?? null, said: String(r.result ?? "").length };
  }
  const events = out.split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const turns = events.filter((e) => e.type === "turn.completed").map((e) => e.usage ?? {});
  const said = events.filter((e) => e.type === "item.completed" && e.item?.type === "agent_message").map((e) => String(e.item.text ?? "")).join("").length;
  const sum = (key: string) => turns.reduce((n, u) => n + (u[key] ?? 0), 0);
  return { input: sum("input_tokens"), cached: sum("cached_input_tokens"), output: sum("output_tokens"), cost: null, said };
}

async function once(cli: string, [title, ask]: string[], lean: boolean): Promise<Run> {
  const dir = project();
  const task = { id: "t", title, area: "code", engine: "claude-code", model: "", prompt: ask, status: "running", runId: null, result: "" } as Task;
  const [cmd, args] = COMMANDS[cli](taskPrompt(task, "Tally", undefined, "", lean));
  const started = Date.now();
  const { out } = await exec(cmd, args, dir, 15 * 60_000);
  const seconds = Math.round((Date.now() - started) / 1000);
  // The fixture's own checks pass untouched, so a run that changed nothing did nothing.
  const changed = spawnSync("git", ["status", "--porcelain"], { cwd: dir }).stdout.toString().trim().length > 0;
  const passed: string[] = [];
  for (const check of CHECKS) if ((await exec("npm", ["run", "-s", check], dir, 5 * 60_000)).code === 0) passed.push(check);
  rmSync(dir, { recursive: true, force: true });
  const spent = usageOf(cli, out);
  return { cli, task: title, lean, seconds, changed, passed, ...spent, ...(spent.input ? {} : { failed: out.slice(0, 400) }) };
}

async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = [];
  const next = async (): Promise<void> => {
    const job = jobs.shift();
    if (!job) return;
    results.push(await job());
    return next();
  };
  await Promise.all(Array.from({ length: size }, next));
  return results;
}

const mean = (runs: Run[], key: "input" | "cached" | "output" | "seconds" | "said") => Math.round(runs.reduce((n, r) => n + r[key], 0) / Math.max(1, runs.length));

function summary(runs: Run[]): string {
  const rows = ["| CLI | Lean | runs | input | cached | output | seconds | closing text | done |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const cli of [...new Set(runs.map((r) => r.cli))]) {
    for (const lean of [false, true]) {
      const these = runs.filter((r) => r.cli === cli && r.lean === lean);
      // Done the way dhrive counts it: it changed the project and all four checks pass.
      const green = these.filter((r) => r.changed && r.passed.length === CHECKS.length).length;
      rows.push(`| ${cli} | ${lean ? "on" : "off"} | ${these.length} | ${mean(these, "input")} | ${mean(these, "cached")} | ${mean(these, "output")} | ${mean(these, "seconds")} | ${mean(these, "said")} chars | ${green}/${these.length} |`);
    }
  }
  return rows.join("\n");
}

describe("lean bench", () => {
  it.skipIf(!process.env.DHRIVE_BENCH)("runs the same tasks with Lean on and off on the real CLIs", async () => {
    const clis = (process.env.DHRIVE_BENCH_CLIS ?? "claude,codex").split(",");
    const repeats = Number(process.env.DHRIVE_BENCH_REPEATS ?? 1);
    const tasks = TASKS.slice(0, Number(process.env.DHRIVE_BENCH_TASKS ?? TASKS.length));
    const jobs = clis.flatMap((cli) => tasks.flatMap((task) => [false, true].flatMap((lean) => Array.from({ length: repeats }, () => () => once(cli, task, lean)))));
    const count = jobs.length;
    const runs = await pool(jobs, 4);
    const file = join(tmpdir(), `dhrive-bench-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(runs, null, 1));
    console.log(`${summary(runs)}\n\nevery run: ${file}`);
    expect(runs).toHaveLength(count);
  }, 4 * 3_600_000);
});
