import { describe, expect, it } from "vitest";

import { nextStatus, STARTED, type PaneEvent, type PaneStatus } from "./terminal-status";

const run = (events: PaneEvent[], from: PaneStatus = STARTED) => events.reduce(nextStatus, from).state;

describe("a pane's status", () => {
  it("works after Enter while the CLI prints, and needs the owner once it goes quiet", () => {
    expect(run([{ kind: "output" }, { kind: "quiet" }]), "its first screen isn't work").toBe("idle");
    expect(run([{ kind: "input", data: "fix the login" }, { kind: "output" }]), "typing isn't asking yet").toBe("idle");
    expect(run([{ kind: "input", data: "\r" }, { kind: "output" }])).toBe("working");
    expect(run([{ kind: "input", data: "\r" }, { kind: "output" }, { kind: "quiet" }])).toBe("needs-you");
    expect(run([{ kind: "input", data: "\r" }, { kind: "output" }, { kind: "quiet" }, { kind: "output" }]), "a redraw after the turn isn't work").toBe("needs-you");
  });

  it("the bell asks for the owner, and looking at the pane or typing answers it", () => {
    expect(run([{ kind: "bell" }])).toBe("needs-you");
    expect(run([{ kind: "bell" }, { kind: "seen" }])).toBe("idle");
    expect(run([{ kind: "bell" }, { kind: "input", data: "y" }])).toBe("idle");
  });

  it("an ended CLI stays ended", () => {
    expect(run([{ kind: "input", data: "\r" }, { kind: "exit" }, { kind: "output" }, { kind: "bell" }])).toBe("ended");
  });
});
