import { useApp } from "./app";
import { useConversations } from "./conversations";
import { useTerminals } from "./terminals";

// Opening a Terminals session is opening a page, as a conversation is: the conversation goes out of
// focus so the sidebar shows one thing open at a time.

export function openSession(id: string) {
  useTerminals.setState({ openId: id });
  useConversations.setState({ open: null });
  useApp.getState().openPage("terminals");
}

export const startSession = (projectId: string) => openSession(useTerminals.getState().create(projectId));
