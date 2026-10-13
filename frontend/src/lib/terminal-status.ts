// What a pane's CLI is up to, read from its terminal alone, since a CLI's own screen says nothing
// dhrive can parse. Output after the owner pressed Enter is work (Claude's spinner keeps drawing while
// it thinks); going quiet after working, or ringing the bell, means it waits for them. Output that
// wasn't asked for (the first screen, a redraw on resize) is never work.

export type PaneState = "idle" | "working" | "needs-you" | "ended";

export interface PaneStatus {
  state: PaneState;
  // Enter was pressed and the CLI hasn't gone quiet since.
  asked: boolean;
}

export type PaneEvent = { kind: "input"; data: string } | { kind: "output" } | { kind: "quiet" } | { kind: "bell" } | { kind: "seen" } | { kind: "exit"; code?: number };

export const STARTED: PaneStatus = { state: "idle", asked: false };

export function nextStatus(status: PaneStatus, event: PaneEvent): PaneStatus {
  if (status.state === "ended") return status;
  switch (event.kind) {
    case "input":
      return { state: status.state === "needs-you" ? "idle" : status.state, asked: status.asked || event.data.includes("\r") };
    case "output":
      return status.asked ? { ...status, state: "working" } : status;
    case "quiet":
      return status.state === "working" ? { state: "needs-you", asked: false } : status;
    case "bell":
      return { ...status, state: "needs-you" };
    case "seen":
      return status.state === "needs-you" ? { ...status, state: "idle" } : status;
    case "exit":
      return { state: "ended", asked: false };
  }
}
