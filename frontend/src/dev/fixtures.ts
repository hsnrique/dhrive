// The made-up world the browser mock (mock.ts) serves: projects, conversations, a plan and its
// changes, the CLIs' earlier sessions, Local models and a few project files. Every name and number
// here is invented. The mock changes some of it as the UI is used (a project added, a model installed),
// so the lists are shared, not copied.

import type { Conversation, LocalScan, PastSession, Project } from "@/lib/api";
import type { Thread } from "@/lib/thread";

export const minutesAgo = (n: number) => Date.now() - n * 60_000;

// The maestro's reply, fenced the way models tend to fence it.
export const SPLIT = `Here is the split:
\`\`\`json
${JSON.stringify([
  { title: "Theme tokens", cli: "codex", prompt: "Add light and dark color tokens in src/theme.ts and export a Theme type. Touch no other file." },
  { title: "Header toggle", cli: "claude", prompt: "Add a ThemeToggle button to src/components/Header.tsx that flips a data-theme attribute on <html> and remembers the choice in localStorage under storefront.theme." },
  { title: "Tests", cli: "antigravity", prompt: "Write tests in tests/theme.test.ts for reading and saving the theme from localStorage." },
])}
\`\`\``;

export const PLAN = `## Plan
Add a theme toggle to the header and remember the choice.

1. **\`src/theme.ts\`**: add \`useTheme()\` that reads and writes \`localStorage\` and sets \`data-theme\` on \`<html>\`.
2. **\`src/components/Header.tsx\`**: add a toggle button next to the account menu.
3. **\`src/index.css\`**: move colors into variables and add a \`[data-theme="dark"]\` block.

### Risks
- A light flash on load: set the theme in \`index.html\` before React mounts.

### Verify
- \`npm test\`, then reload with each theme saved.`;

export const projects: Project[] = [
  { id: "p1", name: "storefront", folder: "/Users/henrique/Code/storefront", createdAt: minutesAgo(900) },
  { id: "p2", name: "billing-api", folder: "/Users/henrique/Code/billing-api", createdAt: minutesAgo(3000) },
  { id: "p3", name: "dhrive-app", folder: "/Users/henrique/Documents/GitHub/dhrive-app", createdAt: minutesAgo(9000) },
];

export const CHANGES = {
  before: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  after: "9f2c1a7e3b5d4c6a8e0f1b2d3c4e5f6a7b8c9d0e",
  files: [
    { path: "src/theme.ts", status: "added" as const, additions: 24, deletions: 0 },
    { path: "src/components/Header.tsx", status: "modified" as const, additions: 9, deletions: 2 },
    { path: "src/index.css", status: "modified" as const, additions: 14, deletions: 6 },
    { path: "public/logo-dark.png", status: "added" as const, additions: null, deletions: null },
  ],
};

export const DIFF = `diff --git a/src/components/Header.tsx b/src/components/Header.tsx
index 3f1a2b4..8c9d0e1 100644
--- a/src/components/Header.tsx
+++ b/src/components/Header.tsx
@@ -1,12 +1,19 @@
 import { AccountMenu } from "./AccountMenu";
+import { useTheme } from "../theme";
 
 export function Header() {
+  const { theme, toggle } = useTheme();
   return (
     <header className="header">
       <Logo />
-      <AccountMenu />
+      <div className="header-actions">
+        <button type="button" aria-label="Switch theme" onClick={toggle}>
+          {theme === "dark" ? <Sun /> : <Moon />}
+        </button>
+        <AccountMenu />
+      </div>
     </header>
   );
 }
`;

export const conversations: Conversation[] = [
  { id: "c1", projectId: "p1", title: "Add a dark mode toggle to the header", createdAt: minutesAgo(42), updatedAt: minutesAgo(12), continues: [] },
  { id: "c2", projectId: "p1", title: "Should we cache the product API?", createdAt: minutesAgo(1500), updatedAt: minutesAgo(1440), continues: [] },
  { id: "c3", projectId: "p2", title: "Retry failed webhooks with backoff", createdAt: minutesAgo(4000), updatedAt: minutesAgo(3900), continues: [] },
];

export const threads: Record<string, Thread> = {
  c2: {
    keepContext: true,
    sessions: {},
    messages: [
      { id: "u9", role: "user", text: "Should we cache the product API?", at: minutesAgo(1440) },
      {
        id: "r9",
        role: "run",
        task: "Should we cache the product API?",
        plan: null,
        chat: true,
        code: { engine: "claude-code", model: "opus", status: "done", output: "Only for reads. Cache `GET /products` for 60 seconds and bust it on writes.", error: null, usage: null, runId: "z", startedAt: minutesAgo(1440), endedAt: minutesAgo(1439), resumed: false },
      },
    ],
  },
  c1: {
    keepContext: true,
    sessions: { "claude-code": "3f48b81e-5044-40ac-aa5f-2f7c80c18525" },
    messages: [
      { id: "u1", role: "user", text: "Add a dark mode toggle to the header and remember the choice.", at: minutesAgo(42) },
      {
        id: "r1",
        role: "run",
        task: "Add a dark mode toggle to the header and remember the choice.",
        plan: { engine: "claude-code", model: "opus", status: "done", output: PLAN, error: null, usage: { inputTokens: 18420, outputTokens: 1210, totalCostUsd: 0.21, numTurns: 6, model: "claude-opus-5-5" }, runId: "a", startedAt: minutesAgo(42), endedAt: minutesAgo(41), resumed: false },
        code: { engine: "codex", model: "gpt-6-astra", status: "done", output: "Added `useTheme()` in `src/theme.ts`, the toggle in `Header.tsx`, and color variables with a dark block in `index.css`. The theme is set in `index.html` before React mounts, so there's no flash.\n\nRan `npm test`: 42 passed.", error: null, usage: { inputTokens: 31200, outputTokens: 2890, totalCostUsd: null, numTurns: 1, model: null }, runId: "b", startedAt: minutesAgo(41), endedAt: minutesAgo(37), resumed: false, changes: CHANGES },
      },
      { id: "u2", role: "user", text: "Also follow the system setting until the user picks one.", at: minutesAgo(12) },
      {
        id: "r2",
        role: "run",
        task: "Also follow the system setting until the user picks one.",
        plan: { engine: "claude-code", model: "opus", status: "done", output: "1. In `useTheme()`, default to `matchMedia('(prefers-color-scheme: dark)')` when nothing is saved.\n2. Listen for changes while nothing is saved.", error: null, usage: { inputTokens: 9100, outputTokens: 340, totalCostUsd: 0.06, numTurns: 3, model: "claude-opus-5-5" }, runId: "c", startedAt: minutesAgo(12), endedAt: minutesAgo(11), resumed: true },
        code: { engine: "codex", model: "gpt-6-astra", status: "failed", output: "", error: "Codex failed: stream disconnected before completion: rate limit reached. Try again in a minute.", usage: null, runId: "d", startedAt: minutesAgo(11), endedAt: minutesAgo(10), resumed: false },
      },
    ],
  },
};

export const CHAT_REPLY = `Worth it, but only for reads. **Cache \`GET /products\` for 60 seconds** and bust it on writes; the list changes a few times a day and it is most of the traffic.

Skip caching the cart: it is per user and changes on every click, so hits would be rare and stale carts cost sales.`;

export const LOG = [
  "Reading src/components/Header.tsx",
  "Reading src/theme.ts",
  "Running npm test",
  "Editing Header.tsx, theme.ts",
  "Tests pass: 43 passed",
];

// The CLIs' own sessions per folder; dhrive's own runs are already left out, as the backend does.
export const pastSessions: Record<string, PastSession[]> = {
  "/Users/henrique/Code/storefront": [
    { engine: "claude-code", id: "9a1c2e33-0f41-4b7a-9d55-1c2d3e4f5a6b", title: "Move checkout to the new payments API", updatedAt: minutesAgo(240), origin: "app", messages: 191 },
    { engine: "codex", id: "01a0650e-2ff3-7b31-b0ca-0729dcb728b4", title: "Checkout migration", updatedAt: minutesAgo(2 * 1440), origin: "app", messages: 7 },
    { engine: "claude-code", id: "5e6f7a8b-1c2d-4e3f-8a9b-0c1d2e3f4a5b", title: "Why is checkout slow on Safari?", updatedAt: minutesAgo(3 * 1440), origin: "terminal", messages: 64 },
    { engine: "claude-code", id: "6a7b8c9d-2e3f-4a5b-9c0d-1e2f3a4b5c6d", title: "Fix the flaky cart test", updatedAt: minutesAgo(6 * 1440), origin: "terminal", messages: 22 },
  ],
  "/Users/henrique/Documents/GitHub/dhrive-app": [
    { engine: "claude-code", id: "7b8c9d0e-3f4a-4b6c-8d1e-2f3a4b5c6d7e", title: "Sign and notarize the macOS build", updatedAt: minutesAgo(90), origin: "app", messages: 48 },
  ],
};

export const scan: LocalScan = {
  machine: { chip: "Apple M5", memoryBytes: 16 * 2 ** 30, freeDiskBytes: 220e9 },
  ollama: "running",
  codex: true,
  context: 4096,
  models: [
    { id: "lfm2.5:8b", label: "LFM 2.5 8B", bytes: 5_156_075_045, fit: "good", installed: false },
    { id: "ornith:9b", label: "Ornith 9B", bytes: 5_629_110_020, fit: "good", installed: false },
    { id: "qwen3.5:9b", label: "Qwen 3.5 9B", bytes: 6_594_474_236, fit: "good", installed: true },
    { id: "qwen3.8:27b", label: "Qwen 3.8 27B", bytes: 17_741_871_939, fit: "too-big", installed: false },
    { id: "laguna-xs-2.1", label: "Laguna XS 2.1 33B", bytes: 20_274_302_663, fit: "too-big", installed: false },
    { id: "ornith:35b", label: "Ornith 35B", bytes: 21_166_759_044, fit: "too-big", installed: false },
    { id: "qwen3.6:35b", label: "Qwen 3.6 35B", bytes: 22_621_314_161, fit: "too-big", installed: false },
    { id: "mistral-medium-3.5:128b", label: "Mistral Medium 3.5 128B", bytes: 80_241_474_657, fit: "too-big", installed: false },
  ],
};

export const THEME_TS = `import { useEffect, useState } from "react";

// The theme the owner picked, or the system's until they pick one.
export type Theme = "light" | "dark";
const KEY = "storefront.theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) ?? "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
`;

export const README = `# storefront

The shop's web front. Built with React and Vite.

## Run it

1. \`npm install\`
2. \`npm run dev\`, then open http://localhost:5173

## Where things are

- **\`src/theme.ts\`**: light and dark themes.
- **\`src/checkout/pay.ts\`**: the payments call.
`;

export function mockFile(path: string) {
  const folders: Record<string, string[]> = {
    "": ["public/", "src/", "index.html", "package.json", "README.md"],
    "src/": ["checkout/", "components/", "index.css", "main.tsx", "theme.ts"],
    "src/components/": ["AccountMenu.tsx", "Cart.tsx", "Header.tsx"],
    "src/checkout/": ["pay.ts", "safari.test.ts"],
    "public/": ["logo-dark.png"],
  };
  if (path in folders) return { kind: "folder", entries: folders[path] };
  if (path === "README.md") return { kind: "text", text: README, truncated: false };
  if (path === "src/theme.ts") return { kind: "text", text: THEME_TS, truncated: false };
  if (path.endsWith(".png")) return { kind: "image", dataUrl: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" rx="12" fill="#222"/><text x="24" y="50" font-size="28" fill="#eee" font-family="sans-serif">storefront</text></svg>') };
  return { kind: "text", text: `// ${path}\nexport {};\n`, truncated: false };
}
