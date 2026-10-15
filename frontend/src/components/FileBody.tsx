import { useEffect, useMemo, useState } from "react";
import { ArrowUp, FileText, Folder } from "lucide-react";

import { readFile, type FileView } from "@/lib/api";
import { highlight, languageOf, type TokenKind } from "@/lib/highlight";
import { cn } from "@/lib/utils";
import { usePanel, type Tab } from "@/store/panel";
import { Markdown } from "./Markdown";
import { useFileSpans } from "./Mentions";

// What a side-panel tab shows: code with line numbers and color, Markdown as it reads (or its
// source), an image, a folder to walk through, or just a binary file's size.

const MAX_LINES = 3000;
const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "",
  comment: "text-code-comment italic",
  string: "text-code-string",
  number: "text-code-number",
  keyword: "text-code-keyword",
};

export const isMarkdown = (path: string) => /\.(md|mdx|markdown)$/i.test(path);

function Code({ text, path }: { text: string; path: string }) {
  // Cut before highlighting: a long file costs only the lines that are shown.
  const { shown, total } = useMemo(() => {
    const all = text.split("\n");
    return { shown: highlight(all.slice(0, MAX_LINES).join("\n"), languageOf(path)), total: all.length };
  }, [text, path]);
  return (
    <div className="overflow-auto py-2 font-mono text-[12px] leading-[1.6] [font-variant-ligatures:none]">
      <table className="border-separate border-spacing-0">
        <tbody>
          {shown.map((line, i) => (
            <tr key={i}>
              <td className="select-none px-3 text-right align-top text-muted-foreground/45 tabular-nums">{i + 1}</td>
              <td className="whitespace-pre pr-6 text-foreground/85">
                {line.map((token, j) => (
                  <span key={j} className={TOKEN_CLASS[token.kind]}>
                    {token.text}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > MAX_LINES && <p className="px-3 pt-2 font-sans text-[12px] text-muted-foreground">Showing the first {MAX_LINES.toLocaleString("en-US")} lines. Open the file to read the rest.</p>}
    </div>
  );
}

function FolderList({ tab, entries }: { tab: Tab; entries: string[] }) {
  const { open, navigate } = usePanel.getState();
  const base = tab.path;
  const up = base.replace(/[^/]+\/$/, "");
  const row = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors hover:bg-white/[0.06]";
  return (
    <div className="grid gap-px p-2">
      {base && (
        <button type="button" className={cn(row, "text-muted-foreground")} onClick={() => navigate(tab, up)}>
          <ArrowUp className="h-3.5 w-3.5" /> ..
        </button>
      )}
      {entries.map((entry) => {
        const folder = entry.endsWith("/");
        const Icon = folder ? Folder : FileText;
        return (
          <button key={entry} type="button" className={row} onClick={() => (folder ? navigate(tab, base + entry) : open(tab.folder, base + entry))}>
            <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" />
            <span className="truncate">{entry.replace(/\/$/, "")}</span>
          </button>
        );
      })}
      {entries.length === 0 && <p className="px-2 py-1 text-[12px] text-muted-foreground">Empty folder.</p>}
    </div>
  );
}

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`);

export function FileBody({ tab, source, version }: { tab: Tab; source: boolean; version: number }) {
  const [state, setState] = useState<{ view: FileView | null; error: string | null }>({ view: null, error: null });
  const renderCode = useFileSpans(tab.folder);

  useEffect(() => {
    let current = true;
    setState({ view: null, error: null });
    readFile(tab.folder, tab.path).then(
      (view) => current && setState({ view, error: null }),
      (error) => current && setState({ view: null, error: String(error) }),
    );
    return () => {
      current = false;
    };
  }, [tab.folder, tab.path, version]);

  const { view, error } = state;
  if (error) return <p className="p-4 text-[12.5px] text-diff-remove">{error}</p>;
  if (!view) return <p className="p-4 text-[12.5px] text-muted-foreground">Loading…</p>;
  if (view.kind === "folder") return <FolderList tab={tab} entries={view.entries} />;
  if (view.kind === "image") return <img src={view.dataUrl} alt={tab.path} className="m-4 max-w-[calc(100%-2rem)] rounded-lg border border-border" />;
  if (view.kind === "binary") return <p className="p-4 text-[12.5px] text-muted-foreground">Binary file · {size(view.bytes)}. Open it in its own app.</p>;
  const cut = view.truncated && <p className="px-4 pb-4 text-[12px] text-muted-foreground">Cut at 1 MB. Open the file to read the rest.</p>;
  if (isMarkdown(tab.path) && !source) {
    return (
      <div className="px-5 py-4">
        <Markdown source={view.text} renderCode={renderCode} />
        {cut}
      </div>
    );
  }
  return (
    <>
      <Code text={view.text} path={tab.path} />
      {cut}
    </>
  );
}
