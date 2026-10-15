import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, PanelLeftOpen, Plus, Search } from "lucide-react";

import type { Project } from "@/lib/api";
import { emailOf, urgent } from "@/lib/account";
import { cn } from "@/lib/utils";
import { useAccount } from "@/store/account";
import { useApp } from "@/store/app";
import { useCompany } from "@/store/company";
import { useConversations } from "@/store/conversations";
import { useSearch } from "@/store/search";
import { initialsOf, useSidebar } from "@/store/sidebar";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "./AccountPanel";
import { DiscordMark, FeedbackDialog, openDiscord } from "./Community";
import { EngineMark } from "./EngineMark";
import { useCompanyPulse } from "./company/CompanyRow";

// The sidebar folded: a rail as wide as the window's traffic lights, with each company as its
// initials (a dot while it works, amber when it waits on the owner), the CLIs, feedback and the
// community, and the account.
// Every button names itself beside the rail on hover, since initials and marks alone don't.

const tool = buttonVariants({ variant: "ghost", size: "icon" });

// Placed on the window, not inside the rail: the rail scrolls, and a scrolling box clips what pokes out.
function Tip({ label, children }: { label: string; children: ReactNode }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  return (
    // On keyboard focus too, and Escape puts it away without moving focus.
    <div
      className="flex"
      onMouseEnter={(e) => setAt(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAt(null)}
      onFocus={(e) => e.target.matches(":focus-visible") && setAt(e.currentTarget.getBoundingClientRect())}
      onBlur={() => setAt(null)}
      onKeyDown={(e) => e.key === "Escape" && at && (e.preventDefault(), setAt(null))}
      onClick={() => setAt(null)}
    >
      {children}
      {at &&
        createPortal(
          <span role="tooltip" style={{ left: at.right + 10, top: at.top + at.height / 2 }} className="pop-in pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[12px] text-foreground shadow-popover">
            {label}
          </span>,
          document.body,
        )}
    </div>
  );
}

function CompanyChip({ project }: { project: Project }) {
  const page = useApp((s) => s.page);
  const companyId = useCompany((s) => s.openId);
  const conversationProject = useConversations((s) => s.open?.projectId);
  const active = page === "company" ? companyId === project.id : page === null && conversationProject === project.id;
  const { working, needsYou } = useCompanyPulse(project.id);
  return (
    <Tip label={needsYou ? `${project.name} · needs your OK` : working ? `${project.name} · working` : project.name}>
      <button
        type="button"
        aria-label={needsYou ? `${project.name}, needs your OK` : working ? `${project.name}, working` : project.name}
        aria-current={active ? "page" : undefined}
        className={cn("relative flex h-10 w-10 items-center justify-center rounded-xl text-[12.5px] font-medium transition-colors", active ? "bg-foreground text-background" : "bg-white/[0.06] text-foreground/80 hover:bg-pressed hover:text-foreground")}
        onClick={() => useCompany.getState().open(project.id)}
      >
        {initialsOf(project.name)}
        {(needsYou || working) && <span className={cn("absolute -right-0.5 -top-0.5 ring-2 ring-card", needsYou ? "h-2 w-2 rotate-45 rounded-[2px] bg-attention" : "node-live h-2.5 w-2.5 rounded-full bg-foreground [--breathe:2]")} />}
      </button>
    </Tip>
  );
}

function Foot() {
  const clis = useApp((s) => s.clis).filter((cli) => cli.installed);
  const status = useAccount((s) => s.status);
  const signedIn = status && status.state !== "free" && status.state !== "signedOut";
  const [writing, setWriting] = useState(false);
  return (
    <div className="flex w-full flex-col items-center gap-1 border-t border-border py-3">
      {clis.map((cli) => (
        <Tip key={cli.engine} label={cli.version ? `${cli.label} ${cli.version}` : cli.label}>
          <button type="button" aria-label={cli.label} className={tool} onClick={() => useApp.getState().openPage(cli.engine)}>
            <EngineMark engine={cli.engine} className="h-4 w-4" />
          </button>
        </Tip>
      ))}
      <div className="my-1 h-px w-8 bg-border" />
      <Tip label="Feedback">
        <button type="button" aria-label="Feedback" className={tool} onClick={() => setWriting(true)}>
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
      </Tip>
      <Tip label="Community on Discord">
        <button type="button" aria-label="Community on Discord" className={tool} onClick={openDiscord}>
          <DiscordMark className="h-3.5 w-3.5" />
        </button>
      </Tip>
      {writing && <FeedbackDialog onClose={() => setWriting(false)} />}
      {signedIn && (
        <Tip label={emailOf(status) ?? "Your account"}>
          <button type="button" aria-label="Your account" className={cn("mt-1 rounded-full", urgent(status) && "ring-1 ring-attention ring-offset-2 ring-offset-card")} onClick={() => useAccount.getState().setSheetOpen(true)}>
            <Avatar email={emailOf(status)} className="h-8 w-8 text-[12px]" />
          </button>
        </Tip>
      )}
    </div>
  );
}

export function SidebarRail({ wide }: { wide: boolean }) {
  const projects = useApp((s) => s.projects);
  const { close } = useConversations.getState();
  return (
    <aside data-tauri-drag-region aria-label="Companies" className="flex h-full w-[72px] flex-none flex-col items-center border-r border-border bg-card pt-[44px]">
      <div className="flex flex-col items-center gap-1 pb-2">
        <Tip label="Show sidebar  ⌘B">
          <button type="button" aria-label="Show sidebar" className={tool} onClick={() => useSidebar.getState().toggle(wide)}>
            <PanelLeftOpen className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </Tip>
        <Tip label="Search  ⌘K">
          <button type="button" aria-label="Search" className={tool} onClick={() => useSearch.getState().setOpen(true)}>
            <Search className="h-3.5 w-3.5" />
          </button>
        </Tip>
        <Tip label="Start a company">
          <button type="button" aria-label="Start a company" className={tool} onClick={close}>
            <Plus className="h-4 w-4" />
          </button>
        </Tip>
      </div>
      <div className="h-px w-8 flex-none bg-border" />
      <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto py-3 [scrollbar-width:none]">
        {projects.map((project) => (
          <CompanyChip key={project.id} project={project} />
        ))}
      </nav>
      <Foot />
    </aside>
  );
}
