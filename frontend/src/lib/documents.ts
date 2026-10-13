import type { Area } from "./day";

// The documents every company keeps under docs/: what it's for, where it's going, how it looks and
// the market it's in. Each is written by the company's agent as an ordinary task, from the brief and
// the project, and every later task reads them.

export type DocumentId = "mission" | "roadmap" | "design-guide" | "market-research";

export interface DocumentKind {
  id: DocumentId;
  title: string;
  file: string;
  area: Area;
  ask: string;
}

export const DOCUMENTS: DocumentKind[] = [
  {
    id: "mission",
    title: "Mission",
    file: "docs/mission.md",
    area: "research",
    ask: "the company's mission: the one sentence it exists for, the problem it solves, who it serves, what it believes and what it will never do. Under 400 words",
  },
  {
    id: "roadmap",
    title: "Product roadmap",
    file: "docs/roadmap.md",
    area: "research",
    ask: "the product roadmap, from the brief's goals and what the project already has: Now (the next two weeks), Next (this quarter) and Later, each item one line with why it matters. Update it rather than rewrite it if it exists",
  },
  {
    id: "design-guide",
    title: "Design guide",
    file: "docs/design-guide.md",
    area: "code",
    ask: "the design guide, taken from what's built: its point of view, color tokens, fonts and type scale, spacing, components and their states, motion, the voice of the interface, and what to avoid. Use the impeccable skill if you have it. Every future interface follows it",
  },
  {
    id: "market-research",
    title: "Market research",
    file: "docs/market-research.md",
    area: "research",
    ask: "the market research, from a short web search (a handful of searches, no more): the market, the main competitors with what they charge and where they fall short, who the customers are and where they gather, and the opening this company aims for. Link every source",
  },
];

export const taskTitle = (kind: DocumentKind) => `Write the ${kind.title.toLowerCase()}`;

export const documentPrompt = (kind: DocumentKind) => `${taskTitle(kind)}\n\nWrite ${kind.file}: ${kind.ask}. Base it on COMPANY.md and the project. Plain Markdown, concrete and short, no filler.`;

// The documents not written yet, in the order they're listed.
export const missing = (written: Record<string, string | null>) => DOCUMENTS.filter((kind) => !written[kind.id]);

// A line to know a document by: its first line of prose, without Markdown's marks.
export function preview(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !/^[-*_]{3,}$/.test(l)) ?? "";
  return line.replace(/^([-*+>]|\d+\.)\s+/, "").replace(/[*_`]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}
