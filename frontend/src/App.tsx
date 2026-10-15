import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { AccountSheet, SignInGate } from "@/components/Account";
import { ErrorToast } from "@/components/ErrorToast";
import { Home } from "@/components/Home";
import { CliPage } from "@/components/CliPage";
import { CompanyView } from "@/components/company/CompanyView";
import { LocalModels } from "@/components/LocalModels";
import { ProjectView } from "@/components/ProjectView";
import { SearchPalette } from "@/components/SearchPalette";
import { Sidebar } from "@/components/Sidebar";
import { TerminalGrid } from "@/components/terminals/TerminalGrid";
import { useTerminals } from "@/store/terminals";
import { UpdateToast } from "@/components/UpdateToast";
import type { ProgressEvent, PullEvent } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";
import { useApp } from "@/store/app";
import { useCompany } from "@/store/company";
import { useConversations } from "@/store/conversations";
import { useGitHub } from "@/store/github";
import { useLocal } from "@/store/local";
import { useSearch } from "@/store/search";

export default function App() {
  const open = useConversations((s) => s.open);
  const project = useApp((s) => s.projects.find((p) => p.id === open?.projectId) ?? null);
  const page = useApp((s) => s.page);
  const companyId = useCompany((s) => s.openId);
  const company = useApp((s) => s.projects.find((p) => p.id === companyId) ?? null);
  const sessions = useTerminals((s) => s.sessions);
  const openId = useTerminals((s) => s.openId);
  const shown = page === "terminals" ? openId : null;
  // Every session opened stays mounted, so moving away never ends the CLIs in it; closing one does.
  const [mounted, setMounted] = useState<string[]>([]);
  useEffect(() => void (shown && setMounted((ids) => (ids.includes(shown) ? ids : [...ids, shown]))), [shown]);

  useEffect(() => {
    const { boot, onProgress, setUpdateReady } = useApp.getState();
    const conversations = useConversations.getState;
    void boot();
    void conversations().load();
    void useAccount.getState().load();
    const listeners = [
      listen<ProgressEvent>("dhrive-progress", (e) => onProgress(e.payload)),
      listen<string>("dhrive-update", (e) => setUpdateReady(e.payload)),
      listen<PullEvent>("dhrive-pull", (e) => useLocal.getState().onPull(e.payload)),
      listen<string>("dhrive-github-code", (e) => useGitHub.getState().onCode(e.payload)),
    ];
    const shortcut = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.metaKey && key === "k") {
        e.preventDefault();
        useSearch.getState().setOpen(!useSearch.getState().open);
      }
      if (e.metaKey && key === "o") {
        e.preventDefault();
        void conversations().openFolder();
      }
      const projectId = conversations().open?.projectId;
      if (e.metaKey && key === "n" && projectId) {
        e.preventDefault();
        conversations().startNew(projectId);
      }
    };
    // CLIs update themselves, and the owner works in the Claude app or Codex, often while dhrive is
    // open; coming back to the window checks both again, at most once a minute.
    let checkedAt = Date.now();
    const recheck = () => {
      if (Date.now() - checkedAt < 60_000) return;
      checkedAt = Date.now();
      void useApp.getState().refreshClis();
      void conversations().loadPast();
      void useAccount.getState().load();
    };
    window.addEventListener("keydown", shortcut);
    window.addEventListener("focus", recheck);
    return () => {
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("focus", recheck);
      listeners.forEach((pending) => void pending.then((unlisten) => unlisten()));
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      {sessions
        .filter((session) => mounted.includes(session.id))
        .map((session) => (
          <main key={session.id} className={cn("min-w-0 flex-1", shown !== session.id && "hidden")}>
            <TerminalGrid session={session} />
          </main>
        ))}
      {!shown && (
        <main className="min-w-0 flex-1">{page === "ollama" ? <LocalModels /> : page === "company" && company ? <CompanyView key={company.id} project={company} /> : page && page !== "terminals" && page !== "company" ? <CliPage key={page} engine={page} /> : project && open ? <ProjectView key={open.conversationId ?? `new:${project.id}:${open.from?.id ?? ""}`} project={project} open={open} /> : <Home />}</main>
      )}
      <UpdateToast />
      <ErrorToast />
      <SearchPalette />
      <AccountSheet />
      <SignInGate />
    </div>
  );
}
