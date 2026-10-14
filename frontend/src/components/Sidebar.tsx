import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PanelLeftClose, Plus, Search } from "lucide-react";

import type { Cli } from "@/lib/api";
import { reportsDetails } from "@/lib/names";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";
import { useCompany } from "@/store/company";
import { useConversations } from "@/store/conversations";
import { useSearch } from "@/store/search";
import { WIDE, sidebarMode, useMediaQuery, useSidebar } from "@/store/sidebar";
import { AccountBadge, AccountRow } from "./Account";
import { BrandLogo } from "./BrandLogo";
import { CommunityRow } from "./Community";
import { EngineMark } from "./EngineMark";
import { UsageHover } from "./PlanUsage";
import { ProjectList } from "./ProjectList";
import { SidebarRail } from "./SidebarRail";

// The version each CLI reports, marked when it changed since dhrive last looked, and flagged when
// that version dropped a flag dhrive drives it with.
function CliVersion({ cli }: { cli: Cli }) {
  if (!cli.version) return null;
  if (cli.missing.length > 0) {
    return (
      <span className="text-[#ff8a8f]" title={`${cli.label} ${cli.version} no longer lists ${cli.missing.join(", ")}, which dhrive uses. Runs may fail until dhrive updates.`}>
        may break
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate font-mono text-[10.5px]" title={cli.updatedFrom ? `Updated from ${cli.updatedFrom}` : undefined}>
      {cli.updatedFrom && <span className="font-sans text-foreground">updated </span>}
      {cli.version}
    </span>
  );
}

function CliRow({ cli }: { cli: Cli }) {
  return (
    <span className="flex w-full items-center gap-2 text-[11.5px] text-muted-foreground">
      <EngineMark engine={cli.engine} className={cn("h-3 w-3", !cli.installed && "opacity-40")} />
      <span className="flex-1">{cli.label}</span>
      <CliVersion cli={cli} />
      {cli.installed ? (
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-foreground/70" title="Installed" />
      ) : (
        <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={() => void openUrl(cli.docsUrl)}>
          Install
        </button>
      )}
    </span>
  );
}

// Ollama's row opens its own screen, since its models are installed from inside dhrive.
function LocalRow({ cli }: { cli: Cli }) {
  const open = useApp((s) => s.page === "ollama");
  const openPage = useApp((s) => s.openPage);
  return (
    <button
      type="button"
      className={cn("-mx-2 flex items-center gap-2 rounded-md px-2 py-0.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground", open && "bg-white/[0.07] text-foreground")}
      onClick={() => openPage("ollama")}
    >
      <EngineMark engine="ollama" className={cn("h-3 w-3", !cli.installed && "opacity-40")} />
      <span className="flex-1">Ollama</span>
      <CliVersion cli={cli} />
      {cli.installed ? <span className="h-1.5 w-1.5 flex-none rounded-full bg-foreground/70" title="Ready" /> : <span>Set up</span>}
    </button>
  );
}

// Projects on the left, each with its conversations and Terminals sessions; the CLIs dhrive found, at the bottom, each
// showing its plan usage on hover and opening its own screen on a click.
function FullSidebar({ onFold }: { onFold: () => void }) {
  const projects = useApp((s) => s.projects);
  const clis = useApp((s) => s.clis);
  const page = useApp((s) => s.page);
  const openPage = useApp((s) => s.openPage);
  const { close } = useConversations.getState();

  return (
    <aside data-tauri-drag-region className="relative flex h-full w-[244px] flex-none flex-col border-r border-border bg-card pt-[44px]">
      {/* In the title bar, level with the traffic lights, where a Mac app keeps its sidebar switch. */}
      <button type="button" title="Hide sidebar (⌘B)" aria-label="Hide sidebar" className="absolute right-3 top-2.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground" onClick={onFold}>
        <PanelLeftClose className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <div data-tauri-drag-region className="flex items-center gap-2 px-4 pb-4">
        <button type="button" className="flex flex-none items-center gap-1.5 rounded-md" title="Home" onClick={close}>
          <BrandLogo className="h-[15px] w-[15px]" />
          <span className="text-[13.5px] font-semibold tracking-tight">dhrive</span>
          {/* Said plainly for as long as it's true. */}
          <span className="rounded-md border border-border px-1 text-[9px] font-medium uppercase leading-[14px] tracking-[0.08em] text-muted-foreground">Beta</span>
        </button>
        <AccountBadge />
        <button
          type="button"
          title="Search (⌘K)"
          aria-label="Search"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground"
          onClick={() => useSearch.getState().setOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Start a company"
          aria-label="Start a company"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.07] hover:text-foreground"
          onClick={close}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="px-4 pb-1.5 text-[11px] text-muted-foreground">Companies</p>
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3">
        {projects.length === 0 ? (
          <button type="button" className="rounded-lg border border-dashed border-border px-3 py-3 text-left text-[12px] leading-relaxed text-muted-foreground transition-colors hover:text-foreground" onClick={close}>
            Start a company from a sentence, or open a folder you already have.
          </button>
        ) : (
          <ProjectList projects={projects} />
        )}
      </nav>
      <footer className="grid gap-1.5 border-t border-border px-4 py-3">
        {clis.map((cli) =>
          cli.engine === "ollama" ? (
            <LocalRow key={cli.engine} cli={cli} />
          ) : cli.installed && reportsDetails(cli.engine) ? (
            <UsageHover key={cli.engine} engine={cli.engine} label={cli.label} active={page === cli.engine} onOpen={() => openPage(cli.engine)}>
              <CliRow cli={cli} />
            </UsageHover>
          ) : (
            <CliRow key={cli.engine} cli={cli} />
          ),
        )}
      </footer>
      <CommunityRow />
      <AccountRow />
    </aside>
  );
}

// ⌘B folds or opens it from anywhere; Escape and going somewhere close it when it's over the work.
function useSidebarKeys(wide: boolean) {
  const page = useApp((s) => s.page);
  const companyId = useCompany((s) => s.openId);
  const conversation = useConversations((s) => s.open?.conversationId);
  useEffect(() => useSidebar.getState().fold(), [page, companyId, conversation]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        useSidebar.getState().toggle(wide);
      } else if (e.key === "Escape" && useSidebar.getState().overlay) {
        useSidebar.getState().fold();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [wide]);
}

export function Sidebar() {
  const wide = useMediaQuery(WIDE);
  const open = useSidebar((s) => s.open);
  const overlay = useSidebar((s) => s.overlay);
  const mode = sidebarMode(open, wide, overlay);
  const { toggle, fold } = useSidebar.getState();
  useSidebarKeys(wide);
  return (
    <>
      <div className={cn("flex flex-none overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none", mode === "docked" ? "w-[244px]" : "w-[72px]")}>
        {mode === "docked" ? <FullSidebar onFold={() => toggle(true)} /> : <SidebarRail wide={wide} />}
      </div>
      {mode === "overlay" && (
        <>
          <div aria-hidden className="fade-in fixed inset-0 z-40 bg-black/50" onClick={fold} />
          <div role="dialog" aria-label="Sidebar" className="slide-in-left fixed inset-y-0 left-0 z-50 flex shadow-[0_24px_70px_rgba(0,0,0,0.6)]">
            <FullSidebar onFold={fold} />
          </div>
        </>
      )}
    </>
  );
}
