// A failed build, as the backend reports one (publish.rs, DIDNT_BUILD), turned into what the owner
// sees and into a task the company's agent can fix it with.

const DIDNT_BUILD = "The website didn't build:";

export const FIX_TITLE = "Fix the website's build";

// The build's own output, if this error is a failed build rather than, say, a lost connection.
export function buildFailure(error: string): string | null {
  const at = error.indexOf(DIDNT_BUILD);
  return at < 0 ? null : error.slice(at + DIDNT_BUILD.length).trim();
}

// The line that names what broke, for the timeline: the first that mentions an error, else the last.
export function headline(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.find((l) => /error|failed|cannot|not found/i.test(l)) ?? lines[lines.length - 1] ?? "the website didn't build").slice(0, 160);
}

export const fixPrompt = (output: string) =>
  `${FIX_TITLE}\n\nThe production build (npm run build, a static export to out/) fails. Find the cause and fix it without removing features or loosening checks, then run the build again and finish only when it passes and writes out/index.html. Its output ended with:\n\n\`\`\`\n${output.slice(-6_000)}\n\`\`\``;
