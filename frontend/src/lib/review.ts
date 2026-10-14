import { STANDARDS } from "./standards";

// Two gates an army's task passes before it lands: its territory (the folders its agent owns, if the
// owner set any) and, when the company asks for it, a review by the company's own agent of the diff.

// What any agent may change, whatever it owns: the docs, the manifest and lockfiles, the env example.
const SHARED = [/^docs\//, /^README\.md$/i, /^package\.json$/, /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/, /^\.env\.example$/];
const MAX_ISSUES = 10;

// "server/, api" → ["server/", "api/"]: folders, each ending in a slash, nothing that climbs out.
export function territoryOf(owns: string): string[] {
  return owns
    .split(/[,\n]/)
    .map((p) => p.trim().replace(/^\.?\//, ""))
    .filter((p) => p && !p.split("/").includes(".."))
    .map((p) => (p.endsWith("/") || p.includes(".") ? p : `${p}/`));
}

// The files changed outside the agent's territory; none when it owns no territory.
export function outside(files: string[], owns: string): string[] {
  const mine = territoryOf(owns);
  if (!mine.length) return [];
  return files.filter((f) => !SHARED.some((r) => r.test(f)) && !mine.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));
}

export const territoryNote = (owns: string) => {
  const mine = territoryOf(owns);
  return mine.length ? `You own ${mine.join(", ")}: change only files there (docs/, the README, package.json and its lockfile are shared). Work that belongs elsewhere, describe in your reply for the agent who owns it.` : "";
};

export const territoryPrompt = (files: string[], owns: string) =>
  `You changed files outside what you own (${territoryOf(owns).join(", ")}): ${files.join(", ")}. Undo those changes, keeping your work inside your own folders, and say in your reply what the agents who own the rest should do.`;

export function reviewPrompt(title: string, prompt: string, diff: string): string {
  return `Review a change one of the company's agents made, before it lands. Its task was "${title}":\n\n${prompt}\n\nThe change, against the company's latest:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nCheck it for bugs, security holes, anything that breaks what the task asked, and against the engineering standard below. Don't edit anything. Reply with APPROVE alone on the first line if it can land as it is; otherwise CHANGES on the first line, then each thing to fix on its own line starting with "- ".\n\n${STANDARDS}`;
}

// What the reviewer decided. Only a reply that asks for changes holds the task back; one that can't
// be read lets it land, so a confused reviewer never stalls the company.
export function parseReview(output: string): { approve: boolean; issues: string[] } {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = (lines[0] ?? "").replace(/[*_#`]/g, "").toUpperCase();
  if (!first.startsWith("CHANGES")) return { approve: true, issues: [] };
  const issues = lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()).filter(Boolean).slice(0, MAX_ISSUES);
  return issues.length ? { approve: false, issues } : { approve: true, issues: [] };
}

export const reviewFixPrompt = (issues: string[]) =>
  `A review of your change asked for these before it lands:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nFix each one, keep everything else as it is, and make sure it still builds and its tests pass.`;
