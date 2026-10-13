import type { RunMessage } from "@/lib/thread";

// How a finished request ended, in the few words a notification has room for. Null when the owner
// ended it themselves (stopped), or it never got to end (dhrive closed).

export interface Outcome {
  text: string;
  // Done is only worth a banner when nothing else is queued; questions and failures always are.
  needsYou: boolean;
}

export function outcome(message: RunMessage): Outcome | null {
  const { plan, code } = message;
  if (plan?.status === "failed") return { text: "The plan failed.", needsYou: true };
  if (code.status === "held") return { text: "The plan has questions for you.", needsYou: true };
  if (code.status === "review") return { text: "The plan is ready for your OK.", needsYou: true };
  if (code.status === "failed") return { text: message.chat ? "The reply failed." : "The code step failed.", needsYou: true };
  if (code.status !== "done") return null;
  if (message.chat) return { text: "Replied.", needsYou: false };
  const files = code.changes?.files.length ?? 0;
  return { text: files ? `Done. ${files === 1 ? "1 file" : `${files} files`} changed.` : "Done.", needsYou: false };
}
