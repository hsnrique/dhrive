import { memo, useMemo } from "react";
import { Clock, X } from "lucide-react";

import type { PastSession } from "@/lib/api";
import { sessionSource } from "@/lib/conversations";
import { stagesFor, type Mode } from "@/lib/flow";
import { cliLabel } from "@/lib/names";
import { queuedIds, type RunMessage } from "@/lib/thread";
import { useApp, useModelName } from "@/store/app";
import { folderOf } from "@/store/conversations";
import { useFiles } from "@/store/files";
import { cancelQueued } from "@/store/runs";
import { AttachmentChips } from "./Attachments";
import { MessageText } from "./Mentions";
import { StageView } from "./StageView";

const NO_MESSAGES: never[] = [];

function QueuedCard({ conversationId, message }: { conversationId: string; message: RunMessage }) {
  return (
    <article className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground">
      <Clock className="h-3.5 w-3.5 flex-none" />
      <span className="flex-1">Queued. Starts when the one above ends.</span>
      <button type="button" title="Take it back" aria-label="Take back this request" className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-hover hover:text-foreground" onClick={() => cancelQueued(conversationId, message.id)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </article>
  );
}

// Memoized: a stage update replaces only its own message, so the other cards keep theirs and skip.
const RunCard = memo(function RunCard({ conversationId, message, queued }: { conversationId: string; message: RunMessage; queued: boolean }) {
  if (queued) return <QueuedCard conversationId={conversationId} message={message} />;
  const handedOff = !["waiting", "skipped", "held", "review", "declined"].includes(message.code.status);
  return (
    <article className="rounded-2xl border border-border bg-card px-4 pt-4">
      {message.plan && <StageView conversationId={conversationId} message={message} step="plan" handedOff={handedOff} />}
      <StageView conversationId={conversationId} message={message} step="code" handedOff={null} />
    </article>
  );
});

// A new conversation opens on the route it will use, so the first request is written knowing who
// does what. One that carries on a CLI session says which, and when the route doesn't reach that
// CLI, that it won't be picked up until it does.
const EMPTY_NOTE: Record<Mode, string> = {
  chat: "Nothing is edited. Switch to Plan when it's time to build.",
  relay: "The plan reads the project without touching it; the code starts once you approve it.",
  code: "Straight to the code, no plan first.",
};
const AUTO_RELAY_NOTE = "The plan reads the project without touching it; the code starts right after.";

function Carries({ from }: { from: PastSession }) {
  const clis = useApp((s) => s.clis);
  const reached = useApp((s) => {
    const { plan, main } = stagesFor(s.mode, s.choices);
    return plan?.engine === from.engine || main?.engine === from.engine;
  });
  return (
    <p className="text-pretty text-[13.5px] leading-relaxed text-foreground/85">
      Carries on “{from.title}” from {sessionSource(from)}.{!reached && ` Pick a ${cliLabel(from.engine, clis)} model to continue it.`}
    </p>
  );
}

function EmptyThread({ from }: { from: PastSession | null }) {
  const { plan, code } = useApp((s) => s.choices);
  const mode = useApp((s) => s.mode);
  const autoCode = useApp((s) => s.autoCode);
  const planner = useModelName(plan?.engine, plan?.model ?? "");
  const coderName = useModelName(code?.engine, code?.model ?? "");
  const coder = code ? coderName : "the coder";
  return (
    <div className="m-auto grid max-w-md justify-items-center gap-3 py-20 text-center">
      <h2 className="display-title">
        {mode === "chat" && <>Think it through with {plan ? planner : "the planner"}.</>}
        {mode === "relay" && plan && (
          <>
            Plan with {planner}.
            <br />
            Code with {coder}.
          </>
        )}
        {(mode === "code" || (mode === "relay" && !plan)) && <>Code with {coder}.</>}
      </h2>
      {from && <Carries from={from} />}
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {mode === "relay" && autoCode ? AUTO_RELAY_NOTE : EMPTY_NOTE[mode]}
      </p>
    </div>
  );
}

// A conversation: the owner's requests and a relay card for each.
export function Thread({ conversationId, from }: { conversationId: string | null; from: PastSession | null }) {
  const thread = useApp((s) => (conversationId ? s.threads[conversationId] : undefined));
  const messages = thread?.messages ?? NO_MESSAGES;
  // Once per change of the thread, not once per card per store update.
  const queued = useMemo(() => queuedIds(thread), [thread]);
  const folder = conversationId ? folderOf(conversationId) : undefined;
  const index = useFiles((s) => (folder ? s.byFolder[folder] : undefined));
  if (!conversationId || messages.length === 0) return <EmptyThread from={from} />;
  return (
    <>
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="ml-auto grid max-w-[78%] justify-items-end gap-1.5">
            <p className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-selected px-3.5 py-2 text-[13.5px] leading-relaxed">
              <MessageText text={message.text} folder={folder} index={index} />
            </p>
            <AttachmentChips items={message.attachments ?? []} className="justify-end" />
          </div>
        ) : (
          <RunCard key={message.id} conversationId={conversationId} message={message} queued={queued.has(message.id)} />
        ),
      )}
    </>
  );
}
