// A company's brief, as the app shows it (five sections) and as it's kept (COMPANY.md, the owner's
// file, which people and CLIs read too). Anything the owner wrote in the file beyond the five
// sections is kept as it is, after them, so editing here never loses a word written there.

export type Section = "product" | "audience" | "voice" | "goals" | "channels";

export type Brief = Record<Section, string> & { rest: string };

export const SECTIONS: { key: Section; heading: string; hint: string; example: string }[] = [
  { key: "product", heading: "Product", hint: "What it is and the problem it solves.", example: "A personal finance spreadsheet that fills itself: budget, investments and net worth in one place." },
  { key: "audience", heading: "Audience", hint: "Who it's for, and what they care about.", example: "People in Brazil who track money in spreadsheets and want it simpler." },
  { key: "voice", heading: "Voice", hint: "How it speaks to them.", example: "Plain, warm, no jargon. Short sentences." },
  { key: "goals", heading: "Goals", hint: "What's worth working toward now.", example: "More Pro trials from ChatGPT Ads. A weekly post people share." },
  { key: "channels", heading: "Channels", hint: "Where it reaches people.", example: "ChatGPT Ads, Instagram, the newsletter." },
];

export const MAX_BRIEF = 20_000;
const MAX_SECTION = 4_000;

export const EMPTY_BRIEF: Brief = { product: "", audience: "", voice: "", goals: "", channels: "", rest: "" };

const BY_HEADING = new Map(SECTIONS.map((s) => [s.heading.toLowerCase(), s.key]));

export function fromMarkdown(text: string): Brief {
  const brief: Brief = { ...EMPTY_BRIEF };
  const rest: string[] = [];
  let current: Section | null = null;
  for (const line of text.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1]?.toLowerCase();
    if (heading !== undefined) current = BY_HEADING.get(heading) ?? null;
    if (heading !== undefined && current) continue;
    // The title line is written back from the project's name.
    if (/^#\s/.test(line) && current === null && rest.length === 0) continue;
    if (current) brief[current] += `${line}\n`;
    else rest.push(line);
  }
  for (const { key } of SECTIONS) brief[key] = brief[key].trim();
  return { ...brief, rest: rest.join("\n").trim() };
}

export function toMarkdown(brief: Brief, name: string): string {
  const sections = SECTIONS.filter((s) => brief[s.key].trim()).map((s) => `## ${s.heading}\n\n${brief[s.key].trim()}`);
  return [`# ${name}`, ...sections, brief.rest.trim()].filter(Boolean).join("\n\n").slice(0, MAX_BRIEF);
}

// One line about the company for the top of its page: the product's first sentence, links reduced
// to their words.
export function tagline(brief: Brief, max = 180): string {
  const plain = brief.product.replace(/\[([^\]]+)\]\((?:<[^>]+>|[^)\s]+)\)/g, "$1").replace(/\s+/g, " ").trim();
  const first = plain.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? plain;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

export const isBlank = (brief: Brief) => SECTIONS.every((s) => !brief[s.key].trim());
export const blanks = (brief: Brief) => SECTIONS.filter((s) => !brief[s.key].trim()).map((s) => s.key);

// The CLI's reply is a JSON object of the five sections; models wrap it in a fence or a sentence
// anyway, so it's read from the first "{" to the last "}". Only plain, bounded strings count.
export function parseDraft(output: string): Partial<Record<Section, string>> {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const parsed: unknown = JSON.parse(output.slice(start, end + 1));
    if (typeof parsed !== "object" || parsed === null) return {};
    const said = parsed as Record<string, unknown>;
    return Object.fromEntries(
      SECTIONS.map(({ key }) => [key, typeof said[key] === "string" ? (said[key] as string).trim().slice(0, MAX_SECTION) : ""]).filter(([, value]) => value),
    );
  } catch {
    return {};
  }
}

// A draft fills only what the owner left empty; what they wrote stays theirs.
export function withDraft(brief: Brief, draft: Partial<Record<Section, string>>): Brief {
  return { ...brief, ...Object.fromEntries(blanks(brief).filter((key) => draft[key]).map((key) => [key, draft[key]])) };
}
