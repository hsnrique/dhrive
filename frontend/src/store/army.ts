import { create } from "zustand";

import { MAX_AGENTS, MAX_NAME, MAX_OWNS, MAX_ROLE, agentByName, newAgent, savedArmy, squadFor, type Agent } from "@/lib/army";
import type { Choice } from "@/lib/flow";
import { companyAgent } from "./company";
import { keeper } from "./records";

// Each company's army, kept in its folder as the army record (records.rs). An agent the owner removes
// goes to the record's archive, never just away.

interface ArmyState {
  byProject: Record<string, Agent[]>;
  hire: (projectId: string, name: string, role: string, owns?: string) => boolean;
  // The software squad (lib/army.ts), each on the company's agent; members already there stay as they are.
  hireSquad: (projectId: string) => void;
  edit: (projectId: string, id: string, patch: Partial<Pick<Agent, "name" | "role" | "owns" | "fallback">> & Partial<Choice>) => boolean;
  dismiss: (projectId: string, id: string) => void;
}

// What the file held and what was hired here before it was read: both kept, this side's version of any agent in both.
export function mergedArmy(saved: Agent[], now: Agent[]): Agent[] {
  const here = new Set(now.map((a) => a.id));
  return [...saved.filter((a) => !here.has(a.id) && !agentByName(now, a.name)), ...now].slice(0, MAX_AGENTS);
}

export const useArmy = create<ArmyState>((set, get) => {
  const army = (projectId: string) => get().byProject[projectId] ?? [];
  const record = keeper("army", (projectId) => ({ agents: army(projectId) }), (projectId, saved) => {
    const fromFile = savedArmy(saved);
    const now = get().byProject[projectId];
    set({ byProject: { ...get().byProject, [projectId]: now ? mergedArmy(fromFile, now) : fromFile } });
    return now !== undefined;
  });
  const put = (projectId: string, agents: Agent[], letGo: Agent[] = []) => {
    set({ byProject: { ...get().byProject, [projectId]: agents } });
    record.persist(projectId, letGo);
  };

  return {
    byProject: {},
    hire: (projectId, name, role, owns = "") => {
      const choice = companyAgent(projectId);
      const made = choice && newAgent(name, role, choice);
      const agent = made && (owns.trim() ? { ...made, owns: owns.trim().slice(0, MAX_OWNS) } : made);
      if (!agent || army(projectId).length >= MAX_AGENTS || agentByName(army(projectId), agent.name)) return false;
      put(projectId, [...army(projectId), agent]);
      return true;
    },
    hireSquad: (projectId) => {
      const choice = companyAgent(projectId);
      if (choice) put(projectId, [...army(projectId), ...squadFor(army(projectId), choice)]);
    },
    edit: (projectId, id, patch) => {
      const name = patch.name?.trim().slice(0, MAX_NAME);
      if (patch.name !== undefined && (!name || army(projectId).some((a) => a.id !== id && agentByName([a], name)))) return false;
      const role = patch.role === undefined ? {} : { role: patch.role.trim().slice(0, MAX_ROLE) };
      const owns = patch.owns === undefined ? {} : { owns: patch.owns.trim().slice(0, MAX_OWNS) };
      put(projectId, army(projectId).map((a) => (a.id === id ? { ...a, ...patch, ...(name ? { name } : {}), ...role, ...owns } : a)));
      return true;
    },
    dismiss: (projectId, id) => {
      const gone = army(projectId).filter((a) => a.id === id);
      put(projectId, army(projectId).filter((a) => a.id !== id), gone);
    },
  };
});

const EMPTY: Agent[] = [];
export const useArmyOf = (projectId: string) => useArmy((s) => s.byProject[projectId] ?? EMPTY);
