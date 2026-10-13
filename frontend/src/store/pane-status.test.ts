import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/api", () => ({ notify }));
let focused = false;
vi.stubGlobal("document", { hasFocus: () => focused });

const { usePaneStatus } = await import("./pane-status");
const s = () => usePaneStatus.getState();

describe("pane status", () => {
  beforeEach(() => {
    usePaneStatus.setState({ byPane: {} });
    notify.mockClear();
  });

  it("notifies once when a pane turns to the owner while dhrive is in the background", () => {
    s().retitle("a", "✳ Fix the login\u0007");
    s().report("a", { kind: "input", data: "\r" }, "Claude Code in storefront");
    s().report("a", { kind: "output" }, "Claude Code in storefront");
    expect(s().byPane.a).toMatchObject({ state: "working", title: "✳ Fix the login" });
    s().report("a", { kind: "quiet" }, "Claude Code in storefront");
    s().report("a", { kind: "bell" }, "Claude Code in storefront");
    expect(s().byPane.a.state).toBe("needs-you");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("✳ Fix the login", "Claude Code in storefront is waiting for you.");
  });

  it("stays quiet while the owner is looking, and forgets a pane that restarts", () => {
    focused = true;
    s().report("b", { kind: "bell" }, "Codex in api");
    expect(notify).not.toHaveBeenCalled();
    s().reset("b");
    expect(s().byPane.b).toBeUndefined();
    focused = false;
  });
});
