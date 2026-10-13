// Mentions of a project's files and folders: "@src/theme.ts" as the owner types it, and the paths a
// model writes in its replies (`src/theme.ts`, `Header.tsx:42`). Folders end in "/".

export interface FileIndex {
  files: Set<string>;
  folders: Set<string>;
  // Every path by its last part, to resolve a bare "Header.tsx" when only one file has that name.
  byName: Map<string, string[]>;
  // Files and folders together, for suggestions.
  all: string[];
}

const baseName = (path: string) => path.replace(/\/$/, "").split("/").pop() ?? path;

export function indexFiles(paths: string[]): FileIndex {
  const files = new Set(paths);
  const folders = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) folders.add(`${parts.slice(0, i).join("/")}/`);
  }
  const byName = new Map<string, string[]>();
  for (const path of [...files, ...folders]) byName.set(baseName(path), [...(byName.get(baseName(path)) ?? []), path]);
  return { files, folders, byName, all: [...folders, ...files] };
}

// What a written path points at, or null. A line number after it (":42", ":42:7", "#L42") is ignored.
export function resolvePath(written: string, index: FileIndex): string | null {
  const path = written.trim().replace(/^@/, "").replace(/^\.\//, "").replace(/(?::\d+){1,2}$|#L\d+(?:-L?\d+)?$/, "");
  if (!path || path.includes(" ")) return null;
  if (index.files.has(path)) return path;
  const folder = path.endsWith("/") ? path : `${path}/`;
  if (index.folders.has(folder)) return folder;
  const named = index.byName.get(baseName(path));
  return !path.includes("/") && named?.length === 1 ? named[0] : null;
}

// The "@query" being typed right before the caret, if any.
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, query: match[2] } : null;
}

function score(path: string, query: string): number | null {
  const name = baseName(path).toLowerCase();
  const full = path.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (full.includes(query)) return 2;
  // Letters in order only within the name: across a whole path almost anything matches.
  let at = 0;
  for (const char of name) if (char === query[at]) at++;
  return at === query.length ? 3 : null;
}

// The best matches for what's typed after "@": name matches first, then path, then the name's letters in order;
// shorter paths win ties. With nothing typed yet, the project's top level.
export function suggest(index: FileIndex, query: string, max = 8): string[] {
  const q = query.toLowerCase();
  if (!q) return index.all.filter((path) => !path.replace(/\/$/, "").includes("/")).slice(0, max);
  return index.all
    .map((path) => ({ path, rank: score(path, q) }))
    .filter((hit): hit is { path: string; rank: number } => hit.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, max)
    .map((hit) => hit.path);
}

// The caret lands after the space that follows the mention, reusing one already there.
export function insertMention(text: string, start: number, caret: number, path: string): { text: string; caret: number } {
  const rest = text.slice(caret);
  const inserted = `@${path}${rest.startsWith(" ") ? "" : " "}`;
  return { text: text.slice(0, start) + inserted + rest, caret: start + inserted.length + (rest.startsWith(" ") ? 1 : 0) };
}

export type Segment = { kind: "text"; text: string } | { kind: "mention"; text: string; path: string };

// The owner's message with each "@path" that names something in the project picked out.
export function segments(text: string, index: FileIndex): Segment[] {
  const parts = text.split(/((?:^|(?<=\s))@[^\s@]+)/);
  const out: Segment[] = [];
  for (const part of parts) {
    if (!part) continue;
    const trailing = /[.,;:!?)]+$/.exec(part)?.[0] ?? "";
    const path = part.startsWith("@") ? resolvePath(part.slice(0, part.length - trailing.length), index) : null;
    if (path) out.push({ kind: "mention", text: part.slice(0, part.length - trailing.length), path }, ...(trailing ? [{ kind: "text" as const, text: trailing }] : []));
    else out.push({ kind: "text", text: part });
  }
  return out;
}
