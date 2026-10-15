import { create } from "zustand";

import { addProject, listConversations, listSessions, loadThread, pickFolder, deleteCompany, removeConversation, saveConversation, type Conversation, type PastSession } from "@/lib/api";
import { instructionsKeyOf, newConversationId, sidebarItems, titleFor, type Open } from "@/lib/conversations";
import { readDraft, writeDraft } from "@/lib/drafts";
import { readSaved, save } from "@/lib/storage";
import { emptyThread, interruptStale } from "@/lib/thread";
import { useApp } from "./app";

// Each project's conversations, the CLIs' earlier sessions in its folder, and which one the main
// view shows. A new conversation only exists once its first request is sent, so opening one and
// walking away leaves nothing behind.

interface ConversationsState {
  conversations: Conversation[];
  // The CLIs' sessions per project id, read again on launch and whenever the window comes back.
  past: Record<string, PastSession[]>;
  open: Open | null;

  load: () => Promise<void>;
  loadPast: () => Promise<void>;
  show: (conversationId: string) => Promise<void>;
  startNew: (projectId: string, from?: PastSession | null) => void;
  openLatest: (projectId: string) => void;
  close: () => void;
  begin: (task: string) => string | null;
  touch: (id: string) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => Promise<void>;
  // The folder's project id once it's in dhrive, for the caller to open.
  openFolder: () => Promise<string | null>;
  deleteProject: (projectId: string) => Promise<void>;
  hidePast: (projectId: string, sessionId: string) => void;
}

const removing = new Set<string>();

// CLI sessions the owner took off the list. Their records stay with the CLI; dhrive never writes
// to those, so hiding is all it can do.
const HIDDEN = "hidden-sessions";
const MAX_HIDDEN = 2000;
const hidden = (): string[] => {
  const saved = readSaved(HIDDEN);
  return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
};

const report = (error: unknown) => useApp.getState().reportError(error);

export const projectOf = (conversationId: string): string | undefined => useConversations.getState().conversations.find((c) => c.id === conversationId)?.projectId;

export function folderOf(conversationId: string): string | undefined {
  const projectId = projectOf(conversationId);
  return useApp.getState().projects.find((p) => p.id === projectId)?.folder;
}

export const useConversations = create<ConversationsState>((set, get) => ({
  conversations: [],
  past: {},
  open: null,

  load: async () => {
    try {
      set({ conversations: await listConversations() });
    } catch (error) {
      report(error);
    }
    await get().loadPast();
  },

  loadPast: async () => {
    const { projects } = useApp.getState();
    if (projects.length === 0) return;
    try {
      const byFolder = await listSessions(projects.map((p) => p.folder));
      const off = new Set(hidden());
      set({ past: Object.fromEntries(projects.map((p) => [p.id, (byFolder[p.folder] ?? []).filter((s) => !off.has(s.id))])) });
    } catch (error) {
      report(error);
    }
  },

  show: async (conversationId) => {
    const conversation = get().conversations.find((c) => c.id === conversationId);
    if (!conversation) return;
    set({ open: { projectId: conversation.projectId, conversationId, from: null } });
    useApp.setState({ page: null });
    if (useApp.getState().threads[conversationId]) return;
    try {
      const thread = interruptStale({ ...emptyThread(), ...(await loadThread(conversationId)) });
      useApp.setState((state) => ({ threads: { ...state.threads, [conversationId]: thread } }));
    } catch (error) {
      report(error);
    }
  },

  // A CLI session already carried on here opens the conversation that carries it, never a second one.
  startNew: (projectId, from = null) => {
    const carrying = from && get().conversations.find((c) => c.continues.includes(from.id));
    if (carrying) return void get().show(carrying.id);
    set({ open: { projectId, conversationId: null, from } });
    useApp.setState({ page: null });
  },

  // A project lands on what happened last in its folder, here or in a CLI, so the context the owner
  // built elsewhere carries straight on.
  openLatest: (projectId) => {
    const { conversations, past } = get();
    const [latest] = sidebarItems(projectId, conversations, past[projectId] ?? []);
    if (latest?.kind === "conversation") void get().show(latest.conversation.id);
    else get().startNew(projectId, latest?.session ?? null);
  },

  close: () => {
    set({ open: null });
    useApp.setState({ page: null });
  },

  // The first request turns the open draft into a conversation; one that carries on a CLI session
  // resumes it from the first request and takes its name. Instructions written before it existed
  // come with it.
  begin: (task) => {
    const { open } = get();
    if (!open || open.conversationId) return open?.conversationId ?? null;
    const { from } = open;
    const now = Date.now();
    const conversation: Conversation = { id: newConversationId(), projectId: open.projectId, title: from?.title ?? titleFor(task), createdAt: now, updatedAt: now, continues: from ? [from.id] : [] };
    const instructions = readDraft(instructionsKeyOf(open));
    writeDraft(instructionsKeyOf(open), "");
    useApp.getState().setThread(conversation.id, () => ({ ...emptyThread(), sessions: from ? { [from.engine]: from.id } : {}, ...(instructions.trim() ? { instructions } : {}) }));
    set((state) => ({ conversations: [conversation, ...state.conversations], open: { ...open, conversationId: conversation.id } }));
    saveConversation(conversation).catch(report);
    return conversation.id;
  },

  touch: (id) => {
    const conversation = get().conversations.find((c) => c.id === id);
    if (!conversation) return;
    const updated = { ...conversation, updatedAt: Date.now() };
    set((state) => ({ conversations: state.conversations.map((c) => (c.id === id ? updated : c)) }));
    saveConversation(updated).catch(report);
  },

  rename: (id, title) => {
    const conversation = get().conversations.find((c) => c.id === id);
    if (!conversation) return;
    const renamed = { ...conversation, title };
    set((state) => ({ conversations: state.conversations.map((c) => (c.id === id ? renamed : c)) }));
    saveConversation(renamed)
      .then((saved) => set((state) => ({ conversations: state.conversations.map((c) => (c.id === id ? { ...c, title: saved.title } : c)) })))
      .catch(report);
  },

  // The CLI's own session is untouched, so one this conversation carried on is listed again. Once at
  // a time: a second click while the first is on its way would fail and say so.
  remove: async (id) => {
    const conversation = get().conversations.find((c) => c.id === id);
    if (!conversation || removing.has(id)) return;
    removing.add(id);
    try {
      await removeConversation(id);
    } catch (error) {
      report(error);
      return;
    } finally {
      removing.delete(id);
    }
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      open: state.open?.conversationId === id ? { projectId: conversation.projectId, conversationId: null, from: null } : state.open,
    }));
    useApp.setState((state) => ({ threads: Object.fromEntries(Object.entries(state.threads).filter(([key]) => key !== id)) }));
  },

  openFolder: async () => {
    try {
      const folder = await pickFolder();
      if (!folder) return null;
      const project = await addProject(folder);
      useApp.setState((state) => ({ projects: [project, ...state.projects.filter((p) => p.id !== project.id)] }));
      await get().loadPast();
      return project.id;
    } catch (error) {
      report(error);
      return null;
    }
  },

  deleteProject: async (projectId) => {
    try {
      await deleteCompany(projectId);
    } catch (error) {
      report(error);
      return;
    }
    const gone = new Set(get().conversations.filter((c) => c.projectId === projectId).map((c) => c.id));
    set((state) => ({
      conversations: state.conversations.filter((c) => c.projectId !== projectId),
      past: Object.fromEntries(Object.entries(state.past).filter(([key]) => key !== projectId)),
      open: state.open?.projectId === projectId ? null : state.open,
    }));
    useApp.setState((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
      threads: Object.fromEntries(Object.entries(state.threads).filter(([key]) => !gone.has(key))),
    }));
  },

  hidePast: (projectId, sessionId) => {
    save(HIDDEN, [...hidden().filter((id) => id !== sessionId), sessionId].slice(-MAX_HIDDEN));
    set((state) => ({ past: { ...state.past, [projectId]: (state.past[projectId] ?? []).filter((s) => s.id !== sessionId) } }));
    const { open } = get();
    if (open?.from?.id === sessionId) get().close();
  },
}));
