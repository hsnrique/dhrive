import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Gauge } from "lucide-react";

import type { Engine, Step } from "@/lib/api";
import type { Choice } from "@/lib/flow";
import { cliLabel, effortLabel } from "@/lib/names";
import { cn } from "@/lib/utils";
import { useApp, useModelName } from "@/store/app";
import { EngineMark } from "./EngineMark";
import { CliTabs, EffortMeter, ModelList } from "./PickerParts";

const NO_EFFORTS: string[] = [];
// About what the panel needs to show its CLIs, a few models and the effort.
const ROOM = 380;

interface PickerProps {
  choice: Choice;
  onChoose: (choice: Choice) => void;
  label: string;
  // The CLIs on offer, when not all of them fit (a Terminals pane has no room for local models).
  engines?: Engine[];
  align?: "left" | "right";
  // Upward by default, for a picker at the bottom of what it sets; downward for one in a header.
  down?: boolean;
  // Whoever runs this choice passes its effort on; a Terminals pane sets it inside the CLI instead.
  tunable?: boolean;
}

// Which CLI and model run something.
export function ChoicePicker({ choice, onChoose, label, engines, align = "left", down = false, tunable = false }: PickerProps) {
  const models = useApp((s) => s.models[choice.engine]);
  const clis = useApp((s) => s.clis);
  const { openPage, loadModels } = useApp.getState();
  const modelName = useModelName(choice.engine, choice.model);
  // The CLI's own default is best named by the CLI.
  const name = choice.model ? modelName : cliLabel(choice.engine, clis);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});

  // Opening asks again (the backend answers from memory unless the CLI changed), so a model
  // installed or released meanwhile shows up.
  useEffect(() => {
    if (open) void loadModels(choice.engine);
  }, [open, choice.engine]);

  // Ollama has no default model worth running, so switching to it lands on one it has.
  useEffect(() => {
    if (choice.engine === "ollama" && !choice.model && models?.[0]) onChoose({ ...choice, model: models[0].id });
  }, [choice, models]);

  // The panel is placed on the window, so it closes when what it hangs from moves; scrolling its own
  // list doesn't count.
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const moved = (e: Event) => !panel.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open]);

  // On the body, not where the trigger sits: inside a glass card the panel would lose its own glass
  // (WebKit drops a backdrop filter nested in another) and the cards after it would paint over it.
  const toggle = () => {
    const at = trigger.current?.getBoundingClientRect();
    if (at) {
      const gap = 8;
      const side = align === "right" ? { right: window.innerWidth - at.right } : { left: at.left };
      const below = window.innerHeight - at.bottom - gap * 2;
      const above = at.top - gap * 2;
      // The preferred side, unless the panel wouldn't fit there and the other side has more room.
      const downward = down ? below >= ROOM || below >= above : above < ROOM && below > above;
      setPlace(downward ? { ...side, top: at.bottom + gap, maxHeight: below } : { ...side, bottom: window.innerHeight - at.top + gap, maxHeight: above });
    }
    setOpen((value) => !value);
  };

  const effortsOf = (model: string) => (tunable && models?.find((m) => m.id === model)?.efforts) || NO_EFFORTS;
  const effort = tunable ? (choice.effort ?? "") : "";
  // A level the next model doesn't take falls back to its CLI's default.
  const setModel = (model: string) => onChoose({ ...choice, model, effort: effortsOf(model).includes(effort) ? effort : undefined });
  const setEffort = (level: string) => onChoose({ ...choice, effort: level || undefined });
  const getModels = () => {
    setOpen(false);
    openPage("ollama");
  };

  const efforts = effortsOf(choice.model);
  const summary = [name, efforts.length > 0 && `effort: ${effort ? effortLabel(effort) : "CLI default"}`].filter(Boolean).join(" · ");

  // In a tight row the model's name gives way first, cut short with its full name on hover.
  return (
    <div className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={summary}
        className="inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white/[0.04] pl-2 pr-1.5 text-xs text-foreground transition-colors hover:bg-white/[0.08]"
        onClick={toggle}
      >
        <EngineMark engine={choice.engine} />
        <span className="min-w-0 max-w-40 truncate font-medium">{choice.engine === "ollama" && !choice.model ? "Pick a model" : name}</span>
        {/* The effort shows on the trigger, so it's seen before the picker is opened. */}
        {efforts.length > 0 && (
          <span className="flex flex-none items-center gap-1 border-l border-border pl-1.5 text-muted-foreground">
            <Gauge className="h-3 w-3" aria-hidden />
            {effort && <span className="text-foreground/85">{effortLabel(effort)}</span>}
          </span>
        )}
        <ChevronDown className={cn("h-3 w-3 flex-none text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={panel} role="dialog" aria-label={label} style={place} className="pop-in fixed z-50 flex w-[360px] flex-col overflow-hidden rounded-xl border border-border bg-popover">
            <CliTabs choice={choice} engines={engines} onPick={(cli) => onChoose(cli.engine === choice.engine ? choice : { engine: cli.engine, model: "" })} onSetUp={getModels} />
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              <ModelList choice={choice} models={models} onPick={setModel} onGetModels={getModels} />
              <input
                aria-label="Any model id"
                className="mx-1.5 mb-1 mt-2 h-8 w-[calc(100%-12px)] rounded-lg border border-border bg-black/30 px-2.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring"
                placeholder="Or type any model id"
                spellCheck={false}
                value={choice.model}
                onChange={(e) => setModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setOpen(false)}
              />
            </div>
            {efforts.length > 0 && (
              <div className="flex-none border-t border-border bg-white/[0.025] px-3 py-2.5">
                <EffortMeter efforts={efforts} effort={effort} onPick={setEffort} />
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// Which CLI and model run one step of a conversation.
export function ModelPicker({ step }: { step: Step }) {
  const choice = useApp((s) => s.choices[step]);
  const choose = useApp((s) => s.choose);
  if (!choice) return null;
  return <ChoicePicker choice={choice} onChoose={(next) => choose(step, next)} label={step === "plan" ? "Planner model" : "Coder model"} align={step === "code" ? "right" : "left"} tunable />;
}
