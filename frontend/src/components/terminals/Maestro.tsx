import { useLayoutEffect, useRef, useState } from "react";
import { Maximize2, Play, X } from "lucide-react";

import type { Cli } from "@/lib/api";
import type { Part } from "@/lib/maestro";
import { cn } from "@/lib/utils";
import { ago, useNow } from "@/lib/time";
import { useApp } from "@/store/app";
import { useDraft, useMaestro } from "@/store/maestro";
import { useTerminals } from "@/store/terminals";
import { useLiveLast, useLivePhase } from "@/store/live";
import { Dialog } from "@/components/ui/layer";
import { buttonVariants } from "@/components/ui/button";
import { ChoicePicker } from "../ModelPicker";
import { FocusPicker } from "./FocusPicker";
import { Intro, MaestroMark, PaneStarters } from "./Start";
import { SendButton, StopButton } from "../ui/compose";

// A session's maestro, above its grid: a brief and the CLI that splits it in the session's project,
// then the subtasks it proposed, each editable before any pane opens.

const words = "flex-none px-0.5 text-xs text-muted-foreground";
const MAX_HEIGHT = 240;
const iconButton = buttonVariants({ variant: "ghost", size: "icon-xs" });

// The phase, then the CLI's latest action, on one line next to the CLI that's splitting.
function Progress({ runId }: { runId: string }) {
  const phase = useLivePhase(runId) || "Starting";
  const doing = useLiveLast(runId);
  const said = doing ? `${phase} · ${doing}` : phase;
  return <p className="truncate text-xs text-muted-foreground" title={said}><span className="node-live mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-foreground align-middle" />{said}</p>;
}

// While the maestro reads, the subtasks it will propose are already sketched in.
function Splitting() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[0, 1, 2].map((at) => (
        <div key={at} className="ghost-sweep flex h-36 flex-col gap-2 rounded-lg border border-border bg-terminal p-3" style={{ animationDelay: `${at * 0.25}s` }}>
          <span className="h-2.5 w-2/5 rounded-full bg-selected" />
          <span className="mt-1 h-2 w-full rounded-full bg-white/[0.05]" />
          <span className="h-2 w-4/5 rounded-full bg-white/[0.05]" />
          <span className="h-2 w-3/5 rounded-full bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}

function PartCard({ session, part, clis, onOpen }: { session: string; part: Part; clis: Cli[]; onOpen: () => void }) {
  const { edit, drop } = useMaestro.getState();
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-terminal p-2.5">
      <div className="flex items-center gap-1">
        <input aria-label="Title" value={part.title} className="-mx-1 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-[12.5px] font-medium outline-none transition-colors hover:border-border focus:border-ring" onChange={(e) => edit(session, part.id, { title: e.target.value })} />
        <button type="button" aria-label="Read and edit" title="Read and edit" className={iconButton} onClick={onOpen}>
          <Maximize2 className="h-3 w-3" />
        </button>
        <button type="button" aria-label="Drop this subtask" title="Drop this subtask" className={iconButton} onClick={() => drop(session, part.id)}>
          <X className="h-3 w-3" />
        </button>
      </div>
      {/* A button won't clamp its own text in WebKit, so the preview is a block inside it. */}
      <button type="button" title="Read and edit" className="text-left text-[11.5px] leading-relaxed text-foreground/75 transition-colors hover:text-foreground" onClick={onOpen}>
        <span className="line-clamp-4 min-h-[4.5rem] whitespace-pre-line">{part.prompt}</span>
      </button>
      <ChoicePicker choice={{ engine: part.engine, model: part.model }} onChoose={(choice) => edit(session, part.id, choice)} label="Subtask CLI" engines={clis.map((cli) => cli.engine)} />
    </div>
  );
}

// One subtask at full size, to read it through and change it before it runs.
function PartDialog({ session, part, clis, onClose }: { session: string; part: Part; clis: Cli[]; onClose: () => void }) {
  const { edit } = useMaestro.getState();
  return (
    <Dialog label={part.title} onClose={onClose} className="flex max-h-full max-w-[760px] flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <input aria-label="Title" value={part.title} className="-mx-1 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 text-[15px] font-semibold tracking-tight outline-none transition-colors hover:border-border focus:border-ring" onChange={(e) => edit(session, part.id, { title: e.target.value })} />
        <button type="button" aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <textarea autoFocus aria-label="Prompt" value={part.prompt} className="h-[55vh] w-full resize-none rounded-xl border border-border bg-black/30 p-3 text-[13px] leading-relaxed outline-none focus:border-ring" onChange={(e) => edit(session, part.id, { prompt: e.target.value })} />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">runs with</span>
        <ChoicePicker choice={{ engine: part.engine, model: part.model }} onChoose={(choice) => edit(session, part.id, choice)} label="Subtask CLI" engines={clis.map((cli) => cli.engine)} />
        <button type="button" className={cn(buttonVariants({ variant: "primary", size: "md" }), "ml-auto px-4")} onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}

// The owner's OK on the whole split: every subtask opens as a pane in its own copy, already at work.
function RunBar({ session, count, room, ranAt }: { session: string; count: number; room: number; ranAt: number | null }) {
  const now = useNow(false);
  const fits = count <= room;
  const said = !fits ? `Room for ${room} more ${room === 1 ? "pane" : "panes"}: drop ${count - room}` : ranAt ? `Ran ${ago(ranAt, now)}` : `${count} ${count === 1 ? "pane" : "panes"}, each in its own copy`;
  return (
    <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
      <span>{said}</span>
      <button type="button" className="ml-auto transition-colors hover:text-foreground" onClick={() => useMaestro.getState().clear(session)}>Clear</button>
      <button type="button" disabled={!fits} className={cn(buttonVariants({ variant: "primary", size: "md" }), "px-4")} onClick={() => useMaestro.getState().run(session)}>
        <Play className="h-3 w-3 fill-current" /> {ranAt ? "Run again" : "Approve and run"}
      </button>
    </div>
  );
}

// Written like a request in a conversation: the brief, then the sentence that routes it.
function Brief({ session, clis }: { session: string; clis: Cli[] }) {
  const folder = useApp((s) => s.projects.find((p) => p.id === useTerminals.getState().sessions.find((t) => t.id === session)?.projectId)?.folder);
  const { brief, runId } = useDraft(session);
  const { model } = useDraft(session);
  const engine = useDraft(session).engine ?? clis[0]?.engine ?? "claude-code";
  const { set, split, stop } = useMaestro.getState();
  const area = useRef<HTMLTextAreaElement>(null);
  const ready = Boolean(brief.trim()) && !runId;
  const submit = () => ready && void split(session, clis.map((cli) => cli.engine));
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [brief]);
  return (
    <div className="rounded-2xl border border-border bg-card p-2 transition-colors focus-within:border-ring">
      <textarea
        ref={area}
        autoFocus
        rows={1}
        value={brief}
        aria-label="Brief"
        placeholder="What should the panes build together?"
        className="block max-h-60 min-h-11 w-full resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        onChange={(e) => set(session, { brief: e.target.value })}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }}
      />
      <div className="flex items-center gap-1.5 px-1 pt-1">
        <span className={words}>split by</span>
        <ChoicePicker choice={{ engine, model }} onChoose={(choice) => set(session, choice)} label="Maestro CLI" engines={clis.map((cli) => cli.engine)} down />
        {folder && <FocusPicker session={session} engine={engine} folder={folder} />}
        <span className="min-w-0 flex-1 px-1">{runId && <Progress runId={runId} />}</span>
        {runId ? (
          <StopButton onClick={() => stop(session)} />
        ) : (
          <SendButton label="Split" title="Split (Enter)" disabled={!ready} onClick={submit} />
        )}
      </div>
    </div>
  );
}

// With no panes yet, the maestro has the whole session to itself; above panes, it keeps to a part.
export function Maestro({ session, clis, room, fill }: { session: string; clis: Cli[]; room: number; fill: boolean }) {
  const { parts, error, runId, ranAt } = useDraft(session);
  const [reading, setReading] = useState<string | null>(null);
  const read = parts.find((p) => p.id === reading);
  // An empty session with nothing split yet: the maestro is the way in.
  const idle = fill && !runId && parts.length === 0;
  return (
    <div className={cn("flex flex-col overflow-y-auto px-4 py-3", fill ? "min-h-0 flex-1" : "max-h-[60%] flex-none border-b border-border")}>
      <div className={cn("mx-auto flex w-full flex-col gap-2", idle ? "my-auto max-w-[680px] pb-16" : "max-w-5xl")}>
        {idle ? <Intro /> : <MaestroMark />}
        <Brief session={session} clis={clis} />
        {idle && <PaneStarters session={session} clis={clis} />}
        {runId && <Splitting />}
        {error && <p className="select-text whitespace-pre-wrap px-2 text-xs leading-relaxed text-failure">{error}</p>}
        {parts.length > 0 && (
          <>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(parts.length, 3)}, minmax(0, 1fr))` }}>
              {parts.map((part) => (
                <PartCard key={part.id} session={session} part={part} clis={clis} onOpen={() => setReading(part.id)} />
              ))}
            </div>
            <RunBar session={session} count={parts.length} room={room} ranAt={ranAt} />
          </>
        )}
      </div>
      {read && <PartDialog session={session} part={read} clis={clis} onClose={() => setReading(null)} />}
    </div>
  );
}
