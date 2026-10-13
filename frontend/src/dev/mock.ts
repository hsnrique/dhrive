// Stands in for the Rust backend when the frontend runs in a plain browser (npm run dev, no
// Tauri), so the UI can be looked at and exercised. main.tsx only loads this in development
// outside Tauri; production builds drop it. The made-up data it serves lives in fixtures.ts and
// accounts.ts.

import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";

import type { AccountStatus, Conversation, Engine, ProgressEvent, StepRequest } from "@/lib/api";
import type { Thread } from "@/lib/thread";
import { listConnections, planUsage } from "./accounts";
import * as env from "./env";
import * as terminal from "./terminal";
import { CHANGES, CHAT_REPLY, conversations, DIFF, LOG, mockFile, pastSessions, PLAN, projects, scan, SPLIT, threads } from "./fixtures";

let context = 148_600;
// Signed out at first, so the sign-in screen shows; signing in waits a moment, as the browser would.
let account: AccountStatus = { state: "signedOut" };
let cancelSignIn: (() => void) | null = null;
let instructions = "- Answer in Portuguese\n- Run the tests before saying it's done";
const companies: Record<string, string> = {};
const sites: Record<string, { running: boolean; startedAt: number }> = {};

let stopped = new Set<string>();
const answers = new Map<string, (allow: boolean) => void>();

async function fakePull(model: string) {
  const total = scan.models.find((m) => m.id === model)?.bytes ?? 4e9;
  stopped.delete(`pull:${model}`);
  for (let step = 0; step <= 20; step++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (stopped.has(`pull:${model}`)) throw new Error("Stopped. Installing again picks up where it left off.");
    await emit("dhrive-pull", { model, status: "downloading", completed: (total * step) / 20, total });
  }
  scan.models = scan.models.map((m) => (m.id === model ? { ...m, installed: true } : m));
}

const COMPANY_DRAFT = JSON.stringify({
  product: "planilha. is personal finance without friction: expenses, budget, investments and net worth in one dashboard.",
  audience: "People in Brazil who keep their money in spreadsheets and want something simpler that still feels like theirs.",
  voice: "Plain Portuguese, warm and direct. No finance jargon, no hype.",
  goals: "Turn ChatGPT Ads clicks into Pro trials. Publish one post a week people save and share.",
  channels: "ChatGPT Ads (set up, with the OpenAI pixel), Instagram, the blog in content/.",
});

const FOUNDED = JSON.stringify({
  name: "Lapse",
  product: "Lapse watches the subscriptions you forgot and cancels the ones you stopped using, before they renew.",
  audience: "Freelancers and small teams who pay for a dozen SaaS tools and lose track of what renews when.",
  voice: "Calm, short, a little dry. Numbers over adjectives.",
  goals: "Get the first 100 people on the waitlist. Learn which tools they forget most.",
  channels: "X, Indie Hackers, a weekly email of renewals worth checking.",
});

const DAY_PLAN = JSON.stringify([
  { title: "Three ChatGPT Ads for Pro", area: "marketing", cli: "claude", prompt: "Write three ChatGPT Ads variants that sell the Pro trial to people who budget in spreadsheets. Save them in marketing/ads/2026-10-07.md." },
  { title: "Weekly Instagram post", area: "marketing", cli: "codex", prompt: "Draft this week's Instagram post on the 50/30/20 rule, with the caption and slide text, in marketing/posts/." },
  { title: "Faster signup form", area: "code", cli: "claude", prompt: "Cut the signup form to email only and add a test for it." },
  { title: "What competitors charge", area: "research", cli: "codex", prompt: "List what the five closest Brazilian finance apps charge, in research/pricing.md." },
]);

// GitHub through gh: not signed in, then signed in, then saved.
let mockGitHub: { gh: boolean; account: string | null; repo: string | null; changes: number } = { gh: true, account: null, repo: null, changes: 7 };

// The first build fails, so the fix path can be seen; every later one passes.
let mockBuilds = 0;

// A company's own domains: connected waiting, then live on the first check.
let mockDomains: { domain: string; live: boolean; waiting?: string[] }[] = [];

// The company's agent answering in its chat, with work it thinks worth doing.
const TALK_REPLY = 'Trials are coming in from the ChatGPT ads, but most stop at the import step: people expect to drop a CSV and the page asks them to paste.\n\nTwo things would help most this week:\n\n```tasks\n[{"title": "CSV drop on import", "area": "code", "prompt": "Let people drop a CSV on the import step and map its columns, with tests."}, {"title": "Import how-to post", "area": "marketing", "prompt": "Draft a short post showing the new CSV import, in marketing/posts/."}]\n```';

async function fakeRun(request: StepRequest) {
  const say = (kind: ProgressEvent["kind"], value: string) => emit("dhrive-progress", { runId: request.runId, kind, value });
  const label = { "claude-code": "Claude Code", codex: "Codex", antigravity: "Antigravity", ollama: "Ollama" }[request.engine];
  await say("phase", `${label} is ${{ plan: "planning", code: "coding", chat: "thinking", split: "splitting the work", company: "learning the company", day: "planning the day", found: "founding the company", talk: "thinking", commit: "writing the commit message" }[request.step]}`);
  for (const line of LOG) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (stopped.has(request.runId)) throw new Error("stopped");
    await say("log", line);
    if (request.step === "code" && line.startsWith("Editing")) {
      await say("edit", JSON.stringify({ path: "src/components/Header.tsx", before: '      <Logo />\n      <AccountMenu />', after: '      <Logo />\n      <div className="header-actions">\n        <ThemeToggle />\n        <AccountMenu />\n      </div>' }));
      await say("edit", JSON.stringify({ path: "src/theme.ts", before: "", after: 'export type Theme = "light" | "dark";\nexport const KEY = "storefront.theme";' }));
    }
  }
  if (request.step === "code") {
    const id = `q-${request.runId}`;
    const allowed = new Promise<boolean>((resolve) => answers.set(id, resolve));
    await say("approval", JSON.stringify({ id, tool: "Bash", detail: "npm test -- --run src/theme", description: "Run the theme tests", rule: "Bash(npm test:*)" }));
    await say("log", (await allowed) ? "Running npm test -- --run src/theme" : "Skipping the tests: not allowed");
    await emit("dhrive-progress", { runId: request.runId, kind: "changes", value: JSON.stringify(CHANGES) });
  }
  return {
    output: request.step === "plan" ? PLAN : request.step === "split" ? SPLIT : request.step === "company" ? COMPANY_DRAFT : request.step === "day" ? DAY_PLAN : request.step === "found" ? FOUNDED : request.step === "chat" ? CHAT_REPLY : request.step === "talk" ? TALK_REPLY : request.step === "commit" ? "Let people drop a CSV on the import step\n\nMost trials stopped at pasting." : "Done. Changed `Header.tsx` and `theme.ts`; `npm test` passes.",
    usage: { inputTokens: 12000, outputTokens: 900, totalCostUsd: request.engine === "codex" ? null : 0.09, numTurns: 3, model: null },
    sessionId: `mock-${request.engine}`,
    needsAnswers: false,
    blocked: request.step === "chat" ? ["Bash: npm test -- --run checkout"] : [],
  };
}

mockIPC(
  async (cmd, args) => {
    const payload = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "list_clis":
        return [
          { engine: "claude-code", label: "Claude Code", installed: true, docsUrl: "https://docs.claude.com/en/docs/claude-code/setup", version: "2.1.290", updatedFrom: "2.1.284", missing: [] },
          { engine: "codex", label: "Codex", installed: true, docsUrl: "https://developers.openai.com/codex/cli/", version: "0.158.0", updatedFrom: null, missing: [] },
          { engine: "antigravity", label: "Antigravity", installed: true, docsUrl: "https://antigravity.google/docs/cli/reference", version: "1.2.17", updatedFrom: null, missing: [] },
          { engine: "ollama", label: "Ollama", installed: true, docsUrl: "https://ollama.com/download", version: "0.34.4", updatedFrom: null, missing: [] },
        ];
      case "list_models":
        if (payload.engine === "ollama") return scan.models.filter((m) => m.installed).map((m) => ({ id: m.id, label: m.id, detail: null }));
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (payload.engine === "antigravity")
          return [
            { id: "", label: "Default", detail: "Antigravity's default" },
            { id: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)", detail: null },
            { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)", detail: null },
            { id: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)", detail: null },
          ];
        return payload.engine === "codex"
          ? [
              { id: "", label: "Default", detail: "Codex's default, now GPT-6-Astra" },
              { id: "gpt-6-astra", label: "GPT-6-Astra", detail: "Frontier intelligence for the most demanding work." },
              { id: "gpt-6-sol", label: "GPT-6-Sol", detail: "Workhorse model for coding and everyday work." },
              { id: "gpt-6-luna", label: "GPT-6-Luna", detail: "Fast and affordable model for easier tasks." },
              { id: "gpt-5.5", label: "GPT-5.5", detail: "Legacy coding model." },
            ].map((m) => ({ ...m, efforts: m.id === "gpt-5.5" ? [] : ["low", "medium", "high", "xhigh"] }))
          : [
              { id: "", label: "Default (recommended)", detail: "Use the default model (currently Opus 5.5) · $4/$20 per Mtok" },
              { id: "opus", label: "Opus", detail: "Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok" },
              { id: "claude-fable-5-1[1m]", label: "Fable", detail: "Fable 5.1 · Most capable for your hardest and longest-running tasks" },
              { id: "sonnet", label: "Sonnet", detail: "Sonnet 5.5 · Efficient for routine tasks · $2/$10 per Mtok" },
              { id: "haiku", label: "Haiku", detail: "Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok" },
            ].map((m) => ({ ...m, efforts: m.id === "haiku" ? [] : ["low", "medium", "high", "xhigh", "max"] }));
      case "read_company":
        return companies[payload.project as string] ?? "";
      case "site_domains":
        return { domains: mockDomains, records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=storefront" }] };
      case "add_site_domain":
        mockDomains.push({ domain: String(payload.domain).trim().toLowerCase(), live: false, waiting: [`${String(payload.domain).trim().toLowerCase()} points at 15.197.142.173. Change its A record to 179.236.65.28.`, `There's no TXT record at _dhrive.${String(payload.domain).trim().toLowerCase()} yet. Add one saying dhrive=storefront.`] });
        return { domains: mockDomains, records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=storefront" }] };
      case "check_site_domain":
        await new Promise((resolve) => setTimeout(resolve, 1200));
        mockDomains = mockDomains.map((d) => (d.domain === payload.domain ? { domain: d.domain, live: true } : d));
        return { domains: mockDomains, records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=storefront" }] };
      case "remove_site_domain":
        mockDomains = mockDomains.filter((d) => d.domain !== payload.domain);
        return { domains: mockDomains, records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=storefront" }] };
      case "site_releases":
        return [0, 1, 26, 30].map((hours, i) => ({ at: Date.now() - hours * 3_600_000 - 7 * 60_000, live: i === 0 }));
      case "make_release_live":
        return null;
      case "build_site":
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (mockBuilds++ === 0) throw "The website didn't build:\n./app/import/page.tsx:42:7\nType error: Property 'rows' does not exist on type 'Sheet'.";
        return null;
      case "github_state":
        return mockGitHub;
      case "github_sign_in":
        await new Promise((resolve) => setTimeout(resolve, 600));
        await emit("dhrive-github-code", "1A2B-3C4D");
        await new Promise((resolve) => setTimeout(resolve, 4000));
        mockGitHub = { ...mockGitHub, account: "henrique" };
        return null;
      case "pending_changes":
        return mockGitHub.changes ? "Files (git status):\n M app/import/page.tsx\n\nDiff:\n+ <DropZone accept=\".csv\" />" : "";
      case "save_to_github":
        await new Promise((resolve) => setTimeout(resolve, 1500));
        mockGitHub = { ...mockGitHub, repo: "https://github.com/henrique/storefront", changes: 0 };
        return mockGitHub.repo;
      case "keep_awake":
        return null;
      case "read_documents":
        return ["mission", "roadmap", "design-guide", "market-research"].map((id) => ({ id, text: id === "mission" ? "# Mission\n\nGive every freelancer a budget they actually keep, in five minutes a week.\n\n## Who we serve\n\nFreelancers in Brazil who budget in spreadsheets." : null }));
      case "save_company":
        companies[payload.project as string] = payload.text as string;
        return null;
      case "read_instructions":
        return instructions;
      case "save_instructions":
        instructions = payload.text as string;
        return null;
      case "list_connections":
        return listConnections(payload.engine as Engine);
      case "plan_usage":
        return planUsage(payload.engine as Engine);
      case "list_projects":
        return projects;
      case "list_conversations":
        return conversations;
      case "save_conversation": {
        const saved = payload.conversation as Conversation;
        const at = conversations.findIndex((c) => c.id === saved.id);
        if (at >= 0) conversations[at] = saved;
        else conversations.unshift(saved);
        return saved;
      }
      case "delete_company":
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return null;
      case "remove_conversation":
        conversations.splice(conversations.findIndex((c) => c.id === payload.id), 1);
        return null;
      case "load_thread":
        return threads[payload.id as string] ?? { messages: [], sessions: {} };
      case "save_thread":
        threads[payload.id as string] = payload.thread as Thread;
        return null;
      case "pick_folder":
        return "/Users/henrique/Code/new-idea";
      // Every company has a website in the mock; Play "starts" dhrive's own dev server, which allows being framed.
      case "site_state": {
        const site = sites[payload.project as string] ?? { running: false, startedAt: 0 };
        const ready = site.running && Date.now() - site.startedAt > 1500;
        return { app: true, running: site.running, port: ready ? 1420 : null, log: site.running ? ["> next dev --hostname 127.0.0.1", ready ? "   - Local:        http://localhost:1420" : "   ▲ Next.js 16.4.0"] : [] };
      }
      case "publish_site":
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return { url: `https://${(projects.find((p) => p.id === payload.project)?.name ?? "company").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.dhrive.site` };
      case "run_site":
        sites[payload.project as string] = { running: true, startedAt: Date.now() };
        return null;
      case "stop_site":
        sites[payload.project as string] = { running: false, startedAt: 0 };
        return null;
      case "founding_dir":
        return "/Users/henrique/Library/Application Support/com.cyostech.dhrive/founding";
      case "found_company": {
        const name = payload.name as string;
        const project = { id: `p${projects.length + 1}`, name, folder: `/Users/henrique/dhrive/${name.toLowerCase()}`, createdAt: Date.now(), allowed: [] };
        projects.unshift(project);
        companies[project.id] = payload.brief as string;
        return project;
      }
      case "add_project": {
        const project = { id: `p${projects.length + 1}`, name: "new-idea", folder: payload.folder as string, createdAt: Date.now() };
        projects.unshift(project);
        return project;
      }
      case "list_files":
        return ["README.md", "index.html", "package.json", "src/main.tsx", "src/theme.ts", "src/index.css", "src/components/Header.tsx", "src/components/AccountMenu.tsx", "src/components/Cart.tsx", "src/checkout/pay.ts", "src/checkout/safari.test.ts"];
      case "open_file":
        return null;
      case "read_file":
        return mockFile(payload.path as string);
      case "answer_approval":
        answers.get(payload.id as string)?.(payload.allow as boolean);
        answers.delete(payload.id as string);
        return null;
      case "allow_in_project": {
        const project = projects.find((p) => p.id === payload.id)!;
        project.allowed = [...(project.allowed ?? []).filter((r) => r !== payload.rule), payload.rule as string];
        return project;
      }
      case "disallow_in_project": {
        const project = projects.find((p) => p.id === payload.id)!;
        project.allowed = (project.allowed ?? []).filter((r) => r !== payload.rule);
        return project;
      }
      case "pick_files":
        return ["/Users/henrique/Desktop/checkout-bug.png", "/Users/henrique/Documents/payments-spec.pdf"];
      case "save_attachment":
        return `/Users/henrique/Library/Application Support/com.cyostech.dhrive/attachments/pasted-${Date.now().toString(16)}.png`;
      case "reveal_file":
        return null;
      case "file_diff":
        return payload.path === "src/components/Header.tsx" ? DIFF : `@@ -0,0 +1 @@\n+// ${payload.path}\n`;
      case "undo_changes":
        return { restored: CHANGES.files.slice(1).map((f) => f.path), kept: ["src/theme.ts"] };
      case "run_step":
        return fakeRun(payload.request as StepRequest);
      case "account_status":
        return account;
      case "sign_in":
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 1500);
          cancelSignIn = () => (clearTimeout(timer), reject("Sign-in cancelled."));
        });
        account = { state: "trial", email: "henrique@example.com", daysLeft: 14 };
        return account;
      case "cancel_sign_in":
        cancelSignIn?.();
        return null;
      case "sign_out":
        account = { state: "signedOut" };
        return account;
      case "git_info":
        return { branch: "main", onDefault: true, canPush: true, gh: true };
      // dhrive's own dev server stands in for a project's: it allows being framed, as most do.
      case "dev_servers":
        return [1420, 3200];
      case "connectors":
        return [
          ["supabase", "Supabase", "Database, sign-in and storage", "Code and data", "https://supabase.com"],
          ["neon", "Neon", "Serverless Postgres", "Code and data", "https://neon.com"],
          ["firecrawl", "Firecrawl", "Web pages as data for the agents", "Code and data", "https://www.firecrawl.dev"],
          ["stripe", "Stripe", "Payments and subscriptions", "Payments", "https://stripe.com"],
          ["polar", "Polar", "Payments, subscriptions and license keys", "Payments", "https://polar.sh"],
          ["posthog", "PostHog", "What people do on the product", "Users", "https://posthog.com"],
          ["resend", "Resend", "Email to the people who use it", "Users", "https://resend.com"],
          ["sentry", "Sentry", "Errors people run into", "Users", "https://sentry.io"],
        ].map(([id, name, what, group, site]) => ({ id, name, what, group, site }));
      case "run_checks":
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return { kind: "ran", checks: ["lint", "typecheck", "test", "build"].map((name) => ({ name, ok: true, tail: "" })), missing: [] };
      case "env_view":
        return env.view();
      case "env_set":
        return env.set(payload.name as string, payload.value as string);
      case "env_remove":
        return env.remove(payload.name as string);
      case "env_restore":
        return env.restore(payload.name as string);
      case "env_reveal":
        return env.reveal(payload.name as string);
      case "suggest_tool":
      case "send_feedback":
        await new Promise((resolve) => setTimeout(resolve, 700));
        return null;
      case "connector_open":
        void terminal.setup(payload.id as string, (payload.connector as string).replace(/^./, (c) => c.toUpperCase()));
        return null;
      case "terminal_open":
        await terminal.open(payload.id as string, payload.engine as string, (payload.task as string | null) ?? null);
        return payload.copy ? `dhrive/${(payload.copy as string).slice(0, 8)}` : null;
      // The last pane brought in conflicts, so the resolve path can be seen.
      case "bring_panes_together": {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const parts = payload.parts as { pane: string }[];
        return {
          branch: `dhrive/${(payload.session as string).slice(0, 8)}`,
          merges: parts.map((p, at) => ({ pane: p.pane, branch: `dhrive/${p.pane.slice(0, 8)}`, outcome: at === parts.length - 1 && at > 0 ? "conflict" : "merged", files: at === parts.length - 1 && at > 0 ? ["src/theme.ts"] : [] })),
        };
      }
      case "open_together_pull_request":
        await new Promise((resolve) => setTimeout(resolve, 900));
        return "https://github.com/example/storefront/pull/42";
      case "remove_pane_copy":
        return null;
      case "terminal_write":
        return terminal.write(payload.id as string, payload.data as string);
      case "terminal_resize":
        return null;
      case "terminal_close":
        return terminal.close(payload.id as string);
      case "commit_step":
        await new Promise((resolve) => setTimeout(resolve, 600));
        return { sha: "a1b2c3d", branch: (payload.branch as string | null) ?? "main" };
      case "open_pull_request":
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return "https://github.com/henrique/storefront/pull/42";
      case "context_usage": {
        const { engine } = payload.session as { engine: string };
        await new Promise((resolve) => setTimeout(resolve, 400));
        return engine === "codex"
          ? { used: 61_200, max: 258_400, parts: [], autoCompactAt: null }
          : { used: context, max: 200_000, autoCompactAt: 167_000, parts: [{ name: "Messages", tokens: context - 55_000 }, { name: "System tools", tokens: 36_443 }, { name: "System prompt", tokens: 7040 }, { name: "Skills", tokens: 7_500 }, { name: "Memory files", tokens: 4_017 }] };
      }
      case "compact_session": {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        if ((payload.session as { engine: string }).engine === "codex") return null;
        context = 61_000;
        return { used: context, max: 200_000, autoCompactAt: 167_000, parts: [{ name: "System tools", tokens: 36_443 }, { name: "System prompt", tokens: 7040 }, { name: "Skills", tokens: 7_500 }, { name: "Messages", tokens: 6_000 }, { name: "Memory files", tokens: 4_017 }] };
      }
      case "search_conversations": {
        const q = (payload.query as string).trim().toLowerCase();
        const said = (t: Thread) => t.messages.flatMap((m) => (m.role === "user" ? [m.text] : [m.plan?.output ?? "", m.code.output]));
        return Object.entries(threads).flatMap(([id, t]) => {
          const text = said(t).find((x) => x.toLowerCase().includes(q));
          return text ? [{ conversationId: id, snippet: text.replace(/\s+/g, " ").slice(0, 120) }] : [];
        });
      }
      case "list_sessions":
        return Object.fromEntries((payload.folders as string[]).map((folder) => [folder, pastSessions[folder] ?? []]));
      case "scan_local":
        return scan;
      case "pull_model":
        return fakePull(payload.model as string);
      case "start_ollama":
        return null;
      case "stop_run":
        stopped = new Set([...stopped, payload.runId as string]);
        return null;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);
