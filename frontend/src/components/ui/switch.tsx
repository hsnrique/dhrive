import { cn } from "@/lib/utils";

interface SwitchProps {
  on: boolean;
  label: string;
  title: string;
  onChange: (on: boolean) => void;
}

// The one on/off control in dhrive: a small track and knob with its label beside it.
export function Switch({ on, label, title, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      className="inline-flex h-7 items-center gap-2 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      onClick={() => onChange(!on)}
    >
      <SwitchTrack on={on} />
      {label}
    </button>
  );
}

function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span className={cn("relative block h-4 w-7 flex-none rounded-full transition-colors duration-200", on ? "bg-foreground/85" : "bg-white/15")}>
      <span className={cn("absolute left-0 top-0.5 h-3 w-3 rounded-full bg-background shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-transform duration-200", on ? "translate-x-3.5" : "translate-x-0.5")} />
    </span>
  );
}
