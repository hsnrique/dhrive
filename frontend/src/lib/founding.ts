import { parseDraft, type Section } from "@/lib/company";

// Founding a company from one sentence, or none: the agent names it and writes its brief; then its
// first day is its first delivery, the product and its website built together. The founding reply
// is the brief's JSON with a name added.

const MAX_NAME = 80;

// Left alone, a model founds the same few companies every time; a corner of the market drawn at
// random sends each surprise somewhere new, and a brief search keeps it honest.
const MARKETS = [
  "pet owners", "independent restaurants", "home renovation", "language learning", "amateur athletes", "small clinics",
  "wedding planning", "indie game developers", "landlords", "freelance designers", "local tradespeople", "podcasters",
  "gardeners", "remote teams", "nonprofits", "music teachers", "e-commerce sellers", "travel planning",
  "parents of young kids", "tabletop gamers", "recruiters", "real estate agents", "coffee roasters", "event venues",
];
const SHAPES = ["a tool they'd use every week", "a service that saves them hours", "a marketplace", "a data product", "something they'd gladly pay a subscription for"];

export function surprise(random: () => number = Math.random): string {
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  return `Surprise me: pick a company worth starting. Look around ${pick(MARKETS)}, for ${pick(SHAPES)}.`;
}

export function parseFounding(output: string): { name: string; draft: Partial<Record<Section, string>> } | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const said = JSON.parse(output.slice(start, end + 1)) as Record<string, unknown>;
    const name = typeof said?.name === "string" ? said.name.trim().slice(0, MAX_NAME) : "";
    return name ? { name, draft: parseDraft(output) } : null;
  } catch {
    return null;
  }
}

// Said to the planner of a new company's first day, after its brief.
export const FIRST_DELIVERY = `This is the company's first day. Plan its first delivery: the product itself, working, and its website, delivered together. Build them as one Next.js app (the latest release, App Router, TypeScript) at the project root, keeping COMPANY.md. The first task creates the app (create-next-app won't scaffold into a folder that has files, so scaffold in a temporary folder and move it in), sets up its quality tooling (TypeScript strict, ESLint, Vitest with a first test, the scripts lint, typecheck, test and build in package.json, and docs/architecture.md describing the layers and where things live) and builds the product's core. The next tasks build on it, in order: the landing page and pricing, then what the first users need. The site is published as a static export, so set output: "export" in next.config and keep to what a static export supports: no API routes or server actions yet, data in the browser or from outside services. The last task makes sure lint, typecheck, tests and the build (which writes out/) all pass and fixes whatever doesn't. Marketing comes after the product works.`;

// Whether dhrive made this folder, directly under ~/dhrive, so deleting the company takes it to the
// Trash too. The backend decides for itself; this only words the question.
export const foundedByDhrive = (folder: string) => /^\/Users\/[^/]+\/dhrive\/[^/]+\/?$/.test(folder);
