import type { Engine, PlanUsage, UsageWindow } from "@/lib/api";

// A CLI's plan usage as it last answered, kept with when it answered. A window that has reset since
// then counts as empty.

export interface KnownUsage {
  usage: PlanUsage;
  at: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const shownPercent = (window: UsageWindow, now: number) => (window.resetsAt !== null && now >= window.resetsAt * 1000 ? 0 : window.percent);

// "12 min", "3 h 46 min", "2 d 4 h": how long until a window resets.
export function resetsIn(resetsAt: number, now: number): string {
  const minutes = Math.max(0, Math.ceil((resetsAt * 1000 - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = (n: number, unit: string) => (n ? ` ${n} ${unit}` : "");
  if (hours < 24) return `${hours} h${rest(minutes % 60, "min")}`;
  return `${Math.floor(hours / 24)} d${rest(hours % 24, "h")}`;
}

const clockTime = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

// "Resets in 3 h 46 min"; a day or more away, the day and time come first ("Resets Mon 09:59, in 6 d").
export function resetText(window: UsageWindow, now: number, clock = clockTime): string | null {
  if (window.resetsAt === null) return null;
  const ms = window.resetsAt * 1000;
  if (now >= ms) return "Reset since it was read";
  const left = resetsIn(window.resetsAt, now);
  return ms - now < DAY_MS ? `Resets in ${left}` : `Resets ${clock(ms)}, in ${left}`;
}

const isWindow = (w: unknown): w is UsageWindow => {
  const v = w as Partial<UsageWindow> | null;
  return typeof v?.label === "string" && typeof v.percent === "number" && (v.resetsAt === null || typeof v.resetsAt === "number") && typeof v.warn === "boolean";
};

function isUsage(u: unknown): u is PlanUsage {
  const v = u as Partial<PlanUsage> | null;
  return Array.isArray(v?.windows) && v.windows.every(isWindow) && Array.isArray(v.shares) && Array.isArray(v.notes);
}

// What an earlier launch saved, keeping only answers that still have an answer's shape.
export function restoreUsage(saved: unknown): Partial<Record<Engine, KnownUsage>> {
  if (!saved || typeof saved !== "object") return {};
  const entries = Object.entries(saved as Record<string, { usage?: unknown; at?: unknown }>);
  return Object.fromEntries(entries.filter(([, known]) => isUsage(known?.usage) && typeof known.at === "number"));
}
