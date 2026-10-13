// Enough syntax coloring to read code at a glance in the side panel: comments, strings, numbers and
// keywords, by file type. It splits text into tokens the UI renders as React spans, so a file's
// contents never become HTML.
// ponytail: one regex per language family, no grammar; nested template strings or a regex literal
// holding quotes can color wrong. A real grammar (Prism, tree-sitter) when that starts to matter.

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword";
export interface Token {
  kind: TokenKind;
  text: string;
}

interface Family {
  comments: string[];
  strings: string[];
  keywords: string[];
}

const C_LIKE = ["//[^\\n]*", "/\\*[\\s\\S]*?\\*/"];
const HASH = ["#[^\\n]*"];
const QUOTES = ['"(?:\\\\.|[^"\\\\\\n])*"', "'(?:\\\\.|[^'\\\\\\n])*'"];

const FAMILIES: Record<string, Family> = {
  js: { comments: C_LIKE, strings: [...QUOTES, "`(?:\\\\.|[^`\\\\])*`"], keywords: ["async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "of", "private", "public", "readonly", "return", "static", "super", "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void", "while", "yield"] },
  rust: { comments: C_LIKE, strings: ['"(?:\\\\.|[^"\\\\])*"'], keywords: ["as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"] },
  python: { comments: HASH, strings: ['"""[\\s\\S]*?"""', "'''[\\s\\S]*?'''", ...QUOTES], keywords: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "if", "import", "in", "is", "lambda", "None", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"] },
  go: { comments: C_LIKE, strings: [...QUOTES, "`[^`]*`"], keywords: ["break", "case", "chan", "const", "continue", "default", "defer", "else", "false", "for", "func", "go", "if", "import", "interface", "map", "nil", "package", "range", "return", "select", "struct", "switch", "true", "type", "var"] },
  swift: { comments: C_LIKE, strings: ['"""[\\s\\S]*?"""', ...QUOTES], keywords: ["actor", "as", "async", "await", "break", "case", "catch", "class", "let", "var", "continue", "default", "defer", "do", "else", "enum", "extension", "false", "for", "func", "guard", "if", "import", "in", "init", "let", "nil", "private", "protocol", "public", "return", "self", "static", "struct", "switch", "throw", "throws", "true", "try", "var", "where", "while"] },
  shell: { comments: HASH, strings: QUOTES, keywords: ["case", "do", "done", "elif", "else", "esac", "export", "fi", "for", "function", "if", "in", "local", "return", "then", "while"] },
  config: { comments: HASH, strings: QUOTES, keywords: ["true", "false", "null", "yes", "no"] },
  css: { comments: ["/\\*[\\s\\S]*?\\*/"], strings: QUOTES, keywords: ["@media", "@import", "@theme", "@layer", "!important"] },
  markup: { comments: ["<!--[\\s\\S]*?-->"], strings: QUOTES, keywords: [] },
  json: { comments: [], strings: ['"(?:\\\\.|[^"\\\\])*"'], keywords: ["true", "false", "null"] },
};

const BY_EXTENSION: Record<string, string> = {
  ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js",
  rs: "rust", py: "python", go: "go", swift: "swift", kt: "js", java: "js", c: "js", h: "js", cpp: "js", cs: "js",
  sh: "shell", zsh: "shell", bash: "shell", fish: "shell",
  yml: "config", yaml: "config", toml: "config", ini: "config", env: "config",
  css: "css", scss: "css",
  html: "markup", xml: "markup", svg: "markup", vue: "markup",
  json: "json", jsonc: "json", lock: "json",
};

const compiled = new Map<string, RegExp>();

function pattern(name: string): RegExp {
  const cached = compiled.get(name);
  if (cached) return cached;
  const family = FAMILIES[name];
  const keywords = family.keywords.length ? `(?<![\\w$@])(?:${family.keywords.map((k) => k.replace(/[$@!]/g, "\\$&")).join("|")})(?![\\w$])` : "(?!)";
  const parts = [family.comments.join("|") || "(?!)", family.strings.join("|") || "(?!)", "\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[\\da-f]+\\b", keywords];
  const regex = new RegExp(parts.map((p) => `(${p})`).join("|"), "gi");
  compiled.set(name, regex);
  return regex;
}

export function languageOf(path: string): string | null {
  const name = path.split("/").pop() ?? "";
  if (name === "Dockerfile" || name === "Makefile") return "shell";
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXTENSION[extension] ?? null;
}

const KINDS: TokenKind[] = ["comment", "string", "number", "keyword"];

// The file as lines of tokens; a comment or string spanning lines is split at each line break.
export function highlight(text: string, language: string | null): Token[][] {
  const tokens: Token[] = [];
  if (language && FAMILIES[language]) {
    const regex = pattern(language);
    regex.lastIndex = 0;
    let at = 0;
    for (let match = regex.exec(text); match; match = regex.exec(text)) {
      if (match[0] === "") {
        regex.lastIndex++;
        continue;
      }
      if (match.index > at) tokens.push({ kind: "plain", text: text.slice(at, match.index) });
      const group = match.slice(1).findIndex((g) => g !== undefined);
      tokens.push({ kind: KINDS[group] ?? "plain", text: match[0] });
      at = match.index + match[0].length;
    }
    if (at < text.length) tokens.push({ kind: "plain", text: text.slice(at) });
  } else {
    tokens.push({ kind: "plain", text });
  }
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    token.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ kind: token.kind, text: part });
    });
  }
  return lines;
}
