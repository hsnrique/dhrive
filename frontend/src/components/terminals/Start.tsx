import type { Cli } from "@/lib/api";
import { useTerminals } from "@/store/terminals";
import { EngineMark } from "../EngineMark";

// What an empty Terminals session opens on: the maestro's brief is the way in, with the plain way
// (one pane, one CLI) right under it.

// Says the screen is the maestro's, wherever it shows.
export function MaestroMark() {
  return (
    <span className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground/80">
      <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
      Maestro
    </span>
  );
}

export function Intro() {
  return (
    <div className="mb-3 px-1">
      <MaestroMark />
      <h2 className="mt-5 font-serif text-[40px] leading-[1.05] tracking-[-0.01em]">
        One task.
        <br />
        Several CLIs at once.
      </h2>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">The maestro splits it into subtasks you approve, each in a pane and a copy of its own.</p>
    </div>
  );
}

export function PaneStarters({ session, clis }: { session: string; clis: Cli[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
      <span className="mr-1 text-xs text-muted-foreground">or open a pane with</span>
      {clis.map((cli) => (
        <button key={cli.engine} type="button" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs transition-colors hover:bg-white/[0.08]" onClick={() => useTerminals.getState().add(session, cli.engine)}>
          <EngineMark engine={cli.engine} className="h-3 w-3" />
          {cli.label}
        </button>
      ))}
    </div>
  );
}
