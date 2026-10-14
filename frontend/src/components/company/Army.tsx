import { useState } from "react";

import type { Project } from "@/lib/api";
import { MAX_AGENTS, PARALLEL, SQUAD, agentByName } from "@/lib/army";
import { useApp } from "@/store/app";
import { useArmy, useArmyOf } from "@/store/army";
import { useDayOf } from "@/store/day";
import { AgentForm, AgentRow } from "./AgentRow";
import { pill } from "./EnvRow";
import { SectionHead } from "./SectionHead";

// The company's army (lib/army.ts): the agents its day is shared between, each with a role and its
// own CLI and model. The software squad is one click; any other agent is a name and a role.

export function Army({ project }: { project: Project }) {
  const army = useArmyOf(project.id);
  const engines = useApp((s) => s.clis).filter((cli) => cli.installed).map((cli) => cli.engine);
  const [hiring, setHiring] = useState(false);
  const { hire, hireSquad } = useArmy.getState();
  const full = army.length >= MAX_AGENTS;
  const squad = !full && SQUAD.some((s) => !agentByName(army, s.name));
  // The war room, as the owner sees it: what the agents delivered lately, newest first.
  const lately = useDayOf(project.id).tasks.filter((t) => t.status === "done" && army.some((a) => a.id === t.agentId)).slice(-4).reverse();
  return (
    <section className="grid gap-3">
      <SectionHead title="Army">
        {squad && <button type="button" className={pill} onClick={() => hireSquad(project.id)}>{army.length ? "Fill the squad" : "Recruit the squad"}</button>}
        {!hiring && !full && <button type="button" className={pill} onClick={() => setHiring(true)}>Recruit</button>}
      </SectionHead>
      <p className="-mt-1 text-[11.5px] text-muted-foreground">Each task goes to the agent whose role fits it. Up to {PARALLEL} work at once, each in its own copy.</p>
      <ul className="grid">
        {hiring && <li><AgentForm onSave={(name, role) => hire(project.id, name, role)} onDone={() => setHiring(false)} /></li>}
        {army.map((agent) => <AgentRow key={agent.id} projectId={project.id} agent={agent} engines={engines} />)}
        {!army.length && !hiring && <li className="px-1 py-2 text-[12px] text-muted-foreground">No agents yet: the company's own agent does every task.</li>}
      </ul>
      {lately.length > 0 && (
        <div className="grid gap-1.5 pt-1">
          <p className="font-mono text-[11px] text-muted-foreground">Lately</p>
          {lately.map((t) => (
            <p key={t.id} className="truncate text-[12px]">
              <span className="font-mono text-muted-foreground">{army.find((a) => a.id === t.agentId)?.name}</span> {t.title}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
