import { create } from "zustand";

// What a screen reader should hear without anyone looking at the screen: a step or a task that
// ended, politely; a run waiting on the owner, at once. Announcer reads it out through two live
// regions. Phases and log lines are left out on purpose: read aloud, they'd never stop.

export type Urgency = "polite" | "assertive";
interface Said {
  text: string;
  // A new number each time, so the same words said twice are heard twice.
  at: number;
}

export const useAnnounce = create<Record<Urgency, Said | null>>(() => ({ polite: null, assertive: null }));

let said = 0;
export function announce(text: string, urgency: Urgency = "polite") {
  useAnnounce.setState({ [urgency]: { text, at: ++said } });
}
