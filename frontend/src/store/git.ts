import { commitStep as commitFiles, openPullRequest } from "@/lib/api";
import { updateStage, type RunMessage } from "@/lib/thread";
import { useApp } from "./app";
import { folderOf } from "./conversations";

// Committing what a code step changed, and opening a pull request for it; what happened is kept on
// the step, so it still says so after a restart. Failures throw for the commit bar to show.

function codeStage(conversationId: string, messageId: string) {
  const message = useApp.getState().threads[conversationId]?.messages.find((m): m is RunMessage => m.id === messageId && m.role === "run");
  return message?.code;
}

export async function commitStep(conversationId: string, messageId: string, message: string, branch: string | null) {
  const folder = folderOf(conversationId);
  const stage = codeStage(conversationId, messageId);
  if (!folder || !stage?.changes || stage.committed || stage.undone) return;
  const committed = await commitFiles(folder, stage.changes.files.map((f) => f.path), message, branch);
  useApp.getState().setThread(conversationId, (t) => updateStage(t, messageId, "code", { committed }));
}

export async function openPr(conversationId: string, messageId: string): Promise<string | undefined> {
  const folder = folderOf(conversationId);
  const committed = codeStage(conversationId, messageId)?.committed;
  if (!folder || !committed) return;
  const pr = await openPullRequest(folder);
  useApp.getState().setThread(conversationId, (t) => updateStage(t, messageId, "code", { committed: { ...committed, pr } }));
  return pr;
}
