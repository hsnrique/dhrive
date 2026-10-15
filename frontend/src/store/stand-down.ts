import { useAuto } from "./auto";
import { useChat } from "./chat";
import { useCompany } from "./company";
import { useDay } from "./day";

// Everything a company has going, stopped: auto mode and its timers, the tasks and the plan in
// flight, a brief being drafted, a chat reply. Done before the company is deleted, so nothing it had
// started goes on writing into a company that's gone (or loops, looking for a folder that isn't there).
export function standDown(projectId: string) {
  if (useAuto.getState().byProject[projectId]?.until) useAuto.getState().stop(projectId);
  useDay.getState().stopPlan(projectId);
  useDay.getState().stop(projectId);
  useCompany.getState().stop(projectId);
  useChat.getState().stop(projectId);
}
