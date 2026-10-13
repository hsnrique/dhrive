import { useMemo, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";

import { parseMarkdown, type Inline } from "@/lib/markdown";

// A code span can stand for something richer, like a file of the project; null keeps it plain code.
type RenderCode = (text: string) => ReactNode | null;

function Inlines({ items, renderCode }: { items: Inline[]; renderCode?: RenderCode }) {
  return (
    <>
      {items.map((item, i) =>
        item.kind === "link" ? (
          <Link key={i} text={item.text} href={item.href} />
        ) : item.kind === "strong" ? (
          <strong key={i} className="font-semibold text-foreground">
            {item.text}
          </strong>
        ) : item.kind === "code" && renderCode?.(item.text) ? (
          <span key={i}>{renderCode(item.text)}</span>
        ) : item.kind === "code" ? (
          <code key={i} className={`rounded bg-white/[0.07] px-1 py-px font-mono text-[0.86em] ${item.strong ? "font-semibold text-foreground" : ""}`}>
            {item.text}
          </code>
        ) : (
          <span key={i}>{item.text}</span>
        ),
      )}
    </>
  );
}

// A web address opens in the browser; anything else (a file the CLI wrote) shows its words, with the
// path on hover, since a raw path means nothing to most readers.
function Link({ text, href }: { text: string; href: string }) {
  if (/^https?:\/\//i.test(href)) {
    return (
      <button type="button" title={href} className="text-foreground underline decoration-white/30 underline-offset-[3px] transition-colors hover:decoration-white/70" onClick={() => void openUrl(href).catch(() => undefined)}>
        {text}
      </button>
    );
  }
  return <span title={href} className="text-foreground">{text}</span>;
}

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg bg-black/45 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground/80">{text}</pre>
      <button type="button" title="Copy" aria-label="Copy the code" className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-black/40 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100" onClick={copy}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// Plans and summaries as the CLIs wrote them, rendered as elements, never as HTML.
export function Markdown({ source, renderCode }: { source: string; renderCode?: RenderCode }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="grid gap-2.5 text-[13.5px] leading-relaxed text-foreground/85">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <h4 key={i} className="mt-1.5 text-[13.5px] font-semibold text-foreground first:mt-0">
              <Inlines items={block.inlines} renderCode={renderCode} />
            </h4>
          );
        }
        if (block.kind === "code") return <CodeBlock key={i} text={block.text} />;
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={i} className={`grid gap-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground`}>
              {block.items.map((item, j) => (
                <li key={j} className="pl-0.5">
                  <Inlines items={item} renderCode={renderCode} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            <Inlines items={block.inlines} renderCode={renderCode} />
          </p>
        );
      })}
    </div>
  );
}
