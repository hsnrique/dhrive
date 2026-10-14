import { describe, expect, it } from "vitest";

import { MAX_AGENTS, MAX_NAME, SQUAD, agentByName, agentIntro, newAgent, rosterNote, savedArmy, squadFor } from "./army";

const CHOICE = { engine: "claude-code" as const, model: "opus" };

describe("a company's army", () => {
  it("hires the squad on the company's agent, skipping who's already there and stopping when full", () => {
    const back = newAgent("back", "Mine", CHOICE)!;
    const squad = squadFor([back], CHOICE);
    expect(squad.map((a) => a.name)).toEqual(SQUAD.map((s) => s.name).filter((n) => n !== "Back"));
    expect(squad.every((a) => a.engine === "claude-code" && a.model === "opus")).toBe(true);
    const crowd = Array.from({ length: MAX_AGENTS - 1 }, (_, i) => newAgent(`a${i}`, "", CHOICE)!);
    expect(squadFor(crowd, CHOICE)).toHaveLength(1);
  });

  it("needs a name, and keeps names and roles to their size", () => {
    expect(newAgent("   ", "role", CHOICE)).toBeNull();
    expect(newAgent("x".repeat(40), "", CHOICE)!.name).toHaveLength(MAX_NAME);
  });

  it("finds an agent by name whatever the case or spaces", () => {
    const army = [newAgent("Front", "", CHOICE)!];
    expect(agentByName(army, " front ")).toBe(army[0]);
    expect(agentByName(army, "Back")).toBeUndefined();
    expect(agentByName(army, 3)).toBeUndefined();
  });

  it("brings back only agents that still look like one, with unique names", () => {
    const army = savedArmy({ agents: [{ id: "1", name: "Back", role: "APIs", engine: "codex", model: "" }, { id: "2", name: "back", engine: "codex", model: "" }, { id: 3, name: "Bad" }, "junk"] });
    expect(army.map((a) => [a.id, a.name, a.role])).toEqual([["1", "Back", "APIs"]]);
    expect(savedArmy(null)).toEqual([]);
    expect(savedArmy({ agents: "no" })).toEqual([]);
  });

  it("tells the planner who's there and to name one per task, and tells each agent who it is", () => {
    expect(rosterNote([])).toBe("");
    const note = rosterNote([newAgent("QA", "Writes the missing tests", CHOICE)!]);
    expect(note).toContain("- QA: Writes the missing tests");
    expect(note).toContain('"agent"');
    expect(agentIntro(newAgent("QA", "Tests", CHOICE)!, "planilha.")).toBe("You are QA, one of planilha.'s agents. Your role: Tests");
  });
});
