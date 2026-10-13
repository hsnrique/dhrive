import { emit } from "@tauri-apps/api/event";

// A stand-in CLI for each pane in the dev mock: a banner like the real one's, then whatever is typed
// echoed back, and Enter answering after a few seconds of spinner, so the grid and its status can be
// seen and typed into.

const BANNERS: Record<string, string> = {
  "claude-code": "\x1b[38;2;217;119;87m ▐▛███▜▌\x1b[0m   Claude Code v2.1.290\r\n\x1b[38;2;217;119;87m▝▜█████▛▘\x1b[0m  Opus 5.5 · Claude Max\r\n\x1b[38;2;217;119;87m  ▘▘ ▝▝\x1b[0m    ~/Code/storefront\r\n\r\n",
  codex: "\x1b[38;2;110;128;244m>_\x1b[0m OpenAI Codex (v0.160.0)\r\nmodel: gpt-6-sol   directory: ~/Code/storefront\r\n\r\n",
  antigravity: "\x1b[38;2;66;133;244m∩\x1b[0m Antigravity 1.2.17 · Gemini 3.1 Pro\r\n\r\n",
};

const send = (id: string, text: string) => emit("dhrive-terminal", { id, kind: "data", data: btoa(String.fromCharCode(...new TextEncoder().encode(text))) });
const lines = new Map<string, string>();

export async function open(id: string, engine: string, task: string | null) {
  lines.set(id, task ?? "");
  await send(id, `${BANNERS[engine] ?? ""}\x1b[2m> \x1b[0m${task ?? ""}`);
  if (task) void write(id, "\r");
}

export async function write(id: string, data: string) {
  if (data !== "\r") {
    lines.set(id, (lines.get(id) ?? "") + data);
    return send(id, data);
  }
  const typed = lines.get(id) ?? "";
  lines.set(id, "");
  await send(id, `\x1b]0;✳ ${typed}\x07\r\n`);
  // A spinner for a few seconds, the way a CLI draws while it works, then its answer.
  for (let frame = 0; frame < 16; frame++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await send(id, `\r\x1b[38;2;217;119;87m${"✻✽✶✳"[frame % 4]}\x1b[0m Working on “${typed}”…`);
  }
  await send(id, `\r\n● Done. Changed 2 files.\r\n\x1b[2m> \x1b[0m`);
}

export const close = (id: string) => void lines.delete(id);

// A connector's setup as it would scroll by: the install, the browser sign-in, the skills, then done.
export async function setup(id: string, name: string) {
  const steps = [`Connecting ${name}…`, `Installing the ${name} CLI…`, "Opening your browser to sign in… signed in.", "Adding skills to .claude/skills and .agents/skills…", "", `${name} is connected. You can close this.`];
  for (const step of steps) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await send(id, `${step}\r\n`);
  }
  await emit("dhrive-terminal", { id, kind: "exit", code: 0 });
}
