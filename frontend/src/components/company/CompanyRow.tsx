import { Building2 } from "lucide-react";

import { needsOwner } from "@/lib/attention";
import { useApp } from "@/store/app";
import { useCompany } from "@/store/company";
import { useDay } from "@/store/day";
import { RowPulse, rowClass } from "../SidebarRow";

// Every project is a company first: its row stays at the top of the project's list, above the work,
// with a dot while its day is being planned or worked, amber when a task waits for the owner's OK.

// Whether the company's day is being planned or worked, and what in it waits on the owner (any of
// an army's running tasks, or suggestions Ask first holds back), in words.
export function useCompanyPulse(projectId: string) {
  const day = useDay((s) => s.byProject[projectId]);
  const working = Boolean(day?.planRunId) || (day?.tasks.some((t) => t.status === "running") ?? false);
  const needsYou = useApp((s) => needsOwner(day?.tasks ?? [], (runId) => (s.approvals[runId]?.length ?? 0) > 0, day?.ask ?? false));
  return { working, needsYou };
}

export function CompanyRow({ projectId }: { projectId: string }) {
  const onCompany = useApp((s) => s.page === "company");
  const shown = useCompany((s) => s.openId === projectId);
  const active = onCompany && shown;
  const { working, needsYou } = useCompanyPulse(projectId);
  return (
    <button type="button" aria-current={active ? "page" : undefined} className={rowClass(active)} onClick={() => useCompany.getState().open(projectId)}>
      <Building2 className="h-[13px] w-[13px] flex-none opacity-70" strokeWidth={1.75} aria-hidden />
      <span className="flex-1 truncate">Company</span>
      <RowPulse needsYou={needsYou} working={working && "Working"} />
    </button>
  );
}
