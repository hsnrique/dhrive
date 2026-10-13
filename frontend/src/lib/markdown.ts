// The small part of Markdown the CLIs actually write in plans and summaries, parsed into blocks
// the UI renders as React elements. Model output never becomes HTML (no innerHTML anywhere).

export type Inline = { kind: "text" | "strong" | "code"; text: string; strong?: boolean } | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string };

// Code spans inside a run of text, kept bold when the run is bold (**`src/theme.ts`**).
function withCode(text: string, strong: boolean): Inline[] {
  return text
    .split(/(`[^`]+`)/)
    .filter((part) => part !== "")
    .map((part): Inline => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return strong ? { kind: "code", text: part.slice(1, -1), strong } : { kind: "code", text: part.slice(1, -1) };
      return { kind: strong ? "strong" : "text", text: part };
    });
}

function withStrong(text: string): Inline[] {
  return text
    .split(/(\*\*.+?\*\*)/)
    .filter((part) => part !== "")
    .flatMap((part) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? withCode(part.slice(2, -2), true) : withCode(part, false)));
}

// [words](https://…) and [words](</a path/with spaces>): the words show, the target stays a target.
const LINK = /\[([^\]]+)\]\((?:<([^>]+)>|([^)\s]+))\)/;

export function parseInline(text: string): Inline[] {
  const found = LINK.exec(text);
  if (!found) return withStrong(text);
  const before = text.slice(0, found.index);
  const after = text.slice(found.index + found[0].length);
  return [...(before ? withStrong(before) : []), { kind: "link", text: found[1].replace(/\*\*|`/g, ""), href: found[2] ?? found[3] }, ...(after ? parseInline(after) : [])];
}

const LIST_ITEM = /^\s*(?:[-*+]|(\d+)[.)])\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith("```")) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = LIST_ITEM.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, inlines: parseInline(heading[2]) });
    } else if (item) {
      flush();
      const ordered = item[1] !== undefined;
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "list" && previous.ordered === ordered) previous.items.push(parseInline(item[2]));
      else blocks.push({ kind: "list", ordered, items: [parseInline(item[2])] });
    } else if (line.trim() === "") {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}
