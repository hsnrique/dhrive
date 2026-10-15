import { useEffect, useRef, useState, type RefObject } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, RotateCw } from "lucide-react";

import { previewHide, previewPlace, previewReload, previewShow } from "@/lib/api";
import { localUrl, portUrl } from "@/lib/preview";
import { cn } from "@/lib/utils";
import { previewOf, usePreview } from "@/store/preview";
import { buttonVariants } from "@/components/ui/button";

// The project's own dev server, beside the conversation. It finds the server the project is running
// and reloads by itself when a code step ends, so the change is seen where it was asked for.

const slotOf = (el: HTMLElement) => {
  const { x, y, width, height } = el.getBoundingClientRect();
  return { x, y, width, height };
};

const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// A native webview draws above everything on the page, so it steps aside while a modal dims the
// window or a popover actually lies over it; a picker opened elsewhere leaves it be. Never when the
// page is inside the dialog itself (the website's sheet).
function useDialogOpen(enabled: boolean, slot: RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const here = slot.current?.getBoundingClientRect();
      const covers = (dialog: Element) => !dialog.contains(slot.current) && (dialog.getAttribute("aria-modal") === "true" || (!!here && overlaps(dialog.getBoundingClientRect(), here)));
      setOpen([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(covers));
    };
    const watch = new MutationObserver(check);
    watch.observe(document.body, { childList: true, subtree: true });
    check();
    return () => watch.disconnect();
  }, [enabled, slot]);
  return open;
}

// In the app the page is a native webview laid over this slot (browser.rs says why): it follows the
// slot as the panel or window resizes, and hides when the tab goes away. In a plain browser (the dev
// mock) an iframe stands in.
export function Page({ url, version }: { url: string; version: number }) {
  const slot = useRef<HTMLDivElement>(null);
  const native = isTauri();
  const covered = useDialogOpen(native, slot);
  useEffect(() => {
    const el = slot.current;
    if (!native || !el || covered) return;
    void previewShow(url, slotOf(el));
    const follow = () => void previewPlace(slotOf(el));
    const resized = new ResizeObserver(follow);
    resized.observe(el);
    window.addEventListener("resize", follow);
    return () => {
      resized.disconnect();
      window.removeEventListener("resize", follow);
      void previewHide();
    };
  }, [url, native, covered]);
  useEffect(() => {
    if (native && version > 0) void previewReload();
  }, [version, native]);
  if (native) return <div ref={slot} className="h-full w-full" />;
  return <iframe key={`${url}#${version}`} title="Preview" src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" className="h-full w-full border-0" />;
}

function Address({ folder, url }: { folder: string; url: string | null }) {
  const [text, setText] = useState(url ?? "");
  const [refused, setRefused] = useState(false);
  useEffect(() => setText(url ?? ""), [url]);
  const go = () => {
    const next = localUrl(text);
    setRefused(!next);
    if (next) usePreview.getState().show(folder, next);
  };
  return (
    <input
      aria-label="Address"
      value={text}
      spellCheck={false}
      placeholder="localhost:3000"
      title={refused ? "Only a page this Mac serves, like localhost:3000" : undefined}
      className={cn("min-w-0 flex-1 rounded-md border border-transparent bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-foreground/85 outline-none focus:border-ring", refused && "border-failure/60")}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && go()}
      onBlur={() => setRefused(false)}
    />
  );
}

function Ports({ folder, ports, url }: { folder: string; ports: number[]; url: string | null }) {
  if (ports.length < 2) return null;
  return ports.map((port) => (
    <button key={port} type="button" title={`Show ${portUrl(port)}`} className={cn("rounded-md px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:bg-hover hover:text-foreground", url?.startsWith(portUrl(port)) && "bg-selected text-foreground")} onClick={() => usePreview.getState().show(folder, portUrl(port))}>
      :{port}
    </button>
  ));
}

const tool = buttonVariants({ variant: "ghost", size: "icon-xs" });

export function BrowserView({ folder }: { folder: string }) {
  const { url, ports, version } = usePreview((s) => previewOf(s, folder));
  const { detect, reload } = usePreview.getState();
  useEffect(() => void detect(folder), [folder, detect]);

  return (
    <>
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <Address folder={folder} url={url} />
        <Ports folder={folder} ports={ports} url={url} />
        <button type="button" title="Reload" aria-label="Reload" className={tool} onClick={() => reload(folder)}>
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="Open in your browser" aria-label="Open in your browser" disabled={!url} className={tool} onClick={() => url && void openUrl(url)}>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 bg-background">
        {url ? (
          <Page url={url} version={version} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-background px-8 text-center">
            <p className="text-[12.5px] text-foreground/85">No dev server running in this project.</p>
            <p className="text-[11.5px] text-muted-foreground">Start one (npm run dev) and reload, or type its port above.</p>
          </div>
        )}
      </div>
    </>
  );
}
