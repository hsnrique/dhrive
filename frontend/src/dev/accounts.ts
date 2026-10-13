// What the CLIs' accounts say about themselves in the browser mock (mock.ts): plan usage and what
// each CLI has connected. Every name and number here is made up.

import type { Connected, Connections, Engine, McpServer, PlanUsage } from "@/lib/api";

const inHours = (n: number) => Math.round(Date.now() / 1000 + n * 3600);

const USAGE: Partial<Record<Engine, PlanUsage>> = {
  "claude-code": {
    plan: "Claude Max",
    account: "henrique@example.com",
    windows: [
      { label: "Session (5 h)", percent: 34, resetsAt: inHours(2.4), warn: false },
      { label: "Week, all models", percent: 61, resetsAt: inHours(4 * 24 + 5), warn: false },
      { label: "Week, Fable", percent: 92, resetsAt: inHours(4 * 24 + 5), warn: true },
    ],
    shares: [
      { label: "Claude Code", percent: 88 },
      { label: "Chats", percent: 12 },
    ],
    notes: ["Extra usage off"],
  },
  codex: {
    plan: "ChatGPT Plus",
    account: "henrique@example.com",
    windows: [
      { label: "Session (5 h)", percent: 12, resetsAt: inHours(3.1), warn: false },
      { label: "Week", percent: 27, resetsAt: inHours(6 * 24), warn: false },
    ],
    shares: [],
    notes: ["2 limit resets available"],
  },
};

export async function planUsage(engine: Engine): Promise<PlanUsage> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const usage = USAGE[engine];
  if (!usage) throw new Error("Ollama runs on this Mac, with no plan to use up.");
  return usage;
}

const server = (name: string, status: McpServer["status"], source: string | null, tools: number | null = null, error: string | null = null): McpServer => ({ name, status, source, tools, error });
const item = (name: string, detail: string | null, source: string | null, on = true): Connected => ({ name, detail, source, on });

const CONNECTIONS: Partial<Record<Engine, Connections>> = {
  "claude-code": {
    servers: [
      server("Supabase", "connected", "claude.ai", 30),
      server("Linear", "connected", "claude.ai", 24),
      server("postgres", "connected", "project", 6),
      server("slack", "needs-auth", "engineering plugin"),
      server("github", "needs-auth", "github plugin"),
      server("gmail", "failed", "sales plugin", null, "No URL configured for this server"),
      server("figma", "connecting", "user"),
    ],
    skills: [
      item("pdf", "Read, fill and make PDF files", "claude.ai sync"),
      item("impeccable", "Design, redesign, critique or polish a frontend interface", "user"),
      item("engineering:code-review", "Review code changes for security, performance and correctness", "engineering plugin"),
      item("engineering:debug", "Structured debugging: reproduce, isolate, fix", "engineering plugin"),
      item("engineering:testing-strategy", "Design test strategies and test plans", "engineering plugin"),
      item("sales:call-prep", "Prepare for a sales call", "sales plugin", false),
      ...Array.from({ length: 9 }, (_, i) => item(`marketing:skill-${i + 1}`, "A marketing skill", "marketing plugin")),
    ],
    plugins: [item("engineering", "1.2.0", "synced"), item("github", null, "user"), item("sales", "2.0.1", "synced", false)],
    agents: [item("Explore", "Read-only search agent for broad fan-out searches", null), item("Plan", "Software architect agent for implementation plans", null)],
    hooks: [item("SessionStart (startup|resume)", "Loading ponytail mode...", "ponytail plugin")],
  },
  codex: {
    servers: [server("codex_apps", "connected", null, 233), server("leadmire", "connected", null, 11), server("code-review", "configured", "code-review plugin")],
    skills: [item("PDF", "Read and make PDFs", "pdf plugin"), item("Documents", "Create and edit Word and Google Docs files", "documents plugin")],
    plugins: [item("Browser", "26.928", "openai-bundled"), item("Canva", "17.0.0", "openai-curated-remote")],
    agents: [],
    hooks: [],
  },
};

export async function listConnections(engine: Engine): Promise<Connections> {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const connections = CONNECTIONS[engine];
  if (!connections) throw new Error("Ollama runs without MCP servers or skills.");
  return connections;
}
