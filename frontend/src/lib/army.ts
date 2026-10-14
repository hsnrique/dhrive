import type { Engine } from "@/lib/api";
import { savedEffort, type Choice } from "@/lib/flow";

// A company's army: agents with a name and a role, each on its own CLI and model. The day's planner
// hears the roster and names who does each task; the task then runs as that agent, its role said
// before the work. A task with no agent is the company's own (the agent picked for the company).

export interface Agent {
  id: string;
  name: string;
  role: string;
  engine: Engine;
  // The CLI's own default when empty.
  model: string;
  effort?: string;
}

export const MAX_AGENTS = 12;
export const MAX_NAME = 24;
export const MAX_ROLE = 1200;

// The squad a software company starts with. Each one runs on the company's agent until the owner
// gives it another CLI or model: dhrive never picks a model for them.
export const SQUAD: { name: string; role: string }[] = [
  { name: "Back", role: "Owns the server side: APIs, data, auth and background jobs. Writes every contract it offers in docs/api/ before the front relies on it." },
  { name: "Front", role: "Owns the interface: pages, components, their states and accessibility, from 360px up. Follows docs/design-guide.md." },
  { name: "QA", role: "Owns quality: writes the tests that are missing, uses the product the way a customer would and fixes what breaks." },
  { name: "Docs", role: "Owns what's written down: the README, docs/architecture.md and the help a customer reads." },
  { name: "Growth", role: "Owns reaching people: landing copy, posts and emails, always as drafts under marketing/." },
];

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function newAgent(name: string, role: string, choice: Choice): Agent | null {
  const n = name.trim().slice(0, MAX_NAME);
  if (!n) return null;
  return { id: crypto.randomUUID(), name: n, role: role.trim().slice(0, MAX_ROLE), engine: choice.engine, model: choice.model, ...savedEffort(choice.effort) };
}

// The squad's members the army doesn't have yet, by name, up to the army's size.
export function squadFor(army: Agent[], choice: Choice): Agent[] {
  const room = MAX_AGENTS - army.length;
  return SQUAD.filter((s) => !army.some((a) => sameName(a.name, s.name)))
    .slice(0, Math.max(0, room))
    .map((s) => newAgent(s.name, s.role, choice))
    .filter((a): a is Agent => a !== null);
}

export const agentByName = (army: Agent[], name: unknown) => (typeof name === "string" && name.trim() ? army.find((a) => sameName(a.name, name)) : undefined);
export const agentById = (army: Agent[], id: string | undefined) => (id ? army.find((a) => a.id === id) : undefined);

// A saved army comes back only as agents that still look like one, names unique.
export function savedArmy(value: unknown): Agent[] {
  const agents = (typeof value === "object" && value !== null ? (value as { agents?: unknown }).agents : null) ?? [];
  if (!Array.isArray(agents)) return [];
  const kept: Agent[] = [];
  for (const item of agents) {
    const a = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const name = text(a.name).slice(0, MAX_NAME);
    if (typeof a.id !== "string" || !name || typeof a.engine !== "string" || typeof a.model !== "string" || agentByName(kept, name)) continue;
    kept.push({ id: a.id, name, role: text(a.role).slice(0, MAX_ROLE), engine: a.engine as Engine, model: a.model, ...savedEffort(a.effort) });
  }
  return kept.slice(0, MAX_AGENTS);
}

// What the planner hears about the army, so it can name who does each task.
export function rosterNote(army: Agent[]): string {
  if (!army.length) return "";
  const lines = army.map((a) => `- ${a.name}: ${a.role || "no role written yet"}`).join("\n");
  return `The company's agents:\n${lines}\n\nFor each task also give "agent": the name of the one agent above whose role fits it best.`;
}

// Said before the task, so the agent works as who it is.
export const agentIntro = (agent: Agent, company: string) => `You are ${agent.name}, one of ${company}'s agents.${agent.role ? ` Your role: ${agent.role}` : ""}`;
