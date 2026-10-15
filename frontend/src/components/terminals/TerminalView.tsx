import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { terminalClose, terminalOpen, terminalResize, terminalWrite, type Engine } from "@/lib/api";
import type { PaneEvent } from "@/lib/terminal-status";

// One CLI's own screen in a pseudo-terminal (terminal.rs), drawn by xterm.js. It starts when the
// pane mounts and ends when it unmounts; xterm draws the CLI's bytes as terminal text, never HTML.

type TerminalEvent = { id: string; kind: "data"; data: string } | { id: string; kind: "exit"; code: number };

const FONT = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const THEME = { background: "#050506", foreground: "#e8e8ea", cursor: "#e8e8ea", selectionBackground: "#ffffff33", black: "#1a1a1d", brightBlack: "#5c5c63" };

// How long a CLI stays silent before it counts as done with its turn. Claude's spinner redraws
// several times a second, so a working CLI never goes this long without printing.
const QUIET_MS = 1800;
const REFIT_MS = 80;

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

interface Props {
  id: string;
  // The CLI the pane runs, unless `start` opens something else in it (a connector's setup).
  engine?: Engine;
  start?: (cols: number, rows: number) => Promise<string | null>;
  project: string;
  // The pane whose own worktree the CLI runs in, or null for the project folder itself.
  copy: string | null;
  model: string;
  // The first message, for a pane the maestro opened; it goes in once, when the CLI starts.
  task: string | null;
  onStarted: () => void;
  onEvent: (event: PaneEvent) => void;
  onTitle: (title: string) => void;
  onBranch: (branch: string | null) => void;
}

export function TerminalView({ id, engine, start, project, copy, model, task, onStarted, onEvent, onTitle, onBranch }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const report = useRef({ onEvent, onTitle, onBranch, onStarted });
  report.current = { onEvent, onTitle, onBranch, onStarted };
  const launch = useRef({ model, task, start });
  launch.current = { model, task, start };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({ fontFamily: FONT, fontSize: 12.5, lineHeight: 1.15, cursorBlink: true, scrollback: 5000, theme: THEME, macOptionIsMeta: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const refit = () => el.clientWidth > 0 && el.clientHeight > 0 && fit.fit();
    let ended = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const said = () => {
      report.current.onEvent({ kind: "output" });
      clearTimeout(quiet);
      quiet = setTimeout(() => report.current.onEvent({ kind: "quiet" }), QUIET_MS);
    };
    // xterm measures one cell once, when it opens; measured on the fallback font, every Plex Mono
    // letter would sit in a cell too wide.
    const fonts = document.fonts.load(`12.5px ${FONT}`).catch(() => undefined).then(() => {
      if (ended) return;
      term.open(el);
      refit();
    });
    // Listening starts before the CLI does, so its first screen is never missed.
    const unlisten = listen<TerminalEvent>("dhrive-terminal", ({ payload }) => {
      if (payload.id !== id) return;
      if (payload.kind === "data") {
        term.write(bytesOf(payload.data));
        return said();
      }
      clearTimeout(quiet);
      report.current.onEvent({ kind: "exit", code: payload.code });
    });
    void Promise.all([unlisten, fonts]).then(() => {
      if (ended) return;
      const { model, task, start } = launch.current;
      const opened = start ? start(term.cols, term.rows) : engine ? terminalOpen(id, engine, project, copy, model, task, term.cols, term.rows) : Promise.reject(new Error("Nothing to run in this terminal."));
      opened
        .then((branch) => {
          report.current.onBranch(branch);
          report.current.onStarted();
          // A task is a message sent: the CLI is at work from its first line.
          if (task) report.current.onEvent({ kind: "input", data: "\r" });
        })
        .catch((error) => term.write(`\x1b[31m${String(error)}\x1b[0m\r\n`));
      term.focus();
    });
    const typed = term.onData((data) => {
      report.current.onEvent({ kind: "input", data });
      void terminalWrite(id, data).catch(() => undefined);
    });
    const rang = term.onBell(() => report.current.onEvent({ kind: "bell" }));
    const titled = term.onTitleChange((title) => report.current.onTitle(title));
    const seen = () => report.current.onEvent({ kind: "seen" });
    el.addEventListener("focusin", seen);
    const resized = term.onResize(({ cols, rows }) => void terminalResize(id, cols, rows).catch(() => undefined));
    // A window or panel drag resizes every frame; the CLI hears one resize when it settles, not dozens
    // that each make it redraw its whole screen.
    let settling: ReturnType<typeof setTimeout> | undefined;
    const follow = new ResizeObserver(() => {
      clearTimeout(settling);
      settling = setTimeout(refit, REFIT_MS);
    });
    follow.observe(el);
    return () => {
      ended = true;
      clearTimeout(quiet);
      clearTimeout(settling);
      el.removeEventListener("focusin", seen);
      follow.disconnect();
      typed.dispose();
      rang.dispose();
      titled.dispose();
      resized.dispose();
      void unlisten.then((stop) => stop());
      void terminalClose(id);
      term.dispose();
    };
  }, [id, engine, project, copy]);

  return <div ref={host} className="h-full w-full overflow-hidden bg-[#050506] px-2 pt-1.5" />;
}
