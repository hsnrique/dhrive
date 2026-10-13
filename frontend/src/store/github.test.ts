import { beforeEach, describe, expect, it, vi } from "vitest";

let state = { gh: true, account: "ana" as string | null, repo: null as string | null, changes: 3 };
let pushFails = false;
const saved: string[] = [];
const messages: (string | undefined)[] = [];
let changes = " M app/page.tsx";
const runStep = vi.fn(async (_request: { step: string; task: string }) => ({ output: "```\nAdd the pricing page\n```" }));
vi.mock("@/lib/api", () => ({
  githubState: vi.fn(async () => state),
  pendingChanges: vi.fn(async () => changes),
  // Knowing a project opens its company's records; none here.
  readCompanyRecord: vi.fn(async () => null),
  saveCompanyRecord: vi.fn(async () => undefined),
  archiveCompanyRecord: vi.fn(async () => undefined),
  runStep,
  saveToGithub: vi.fn(async (project: string, message?: string) => {
    if (pushFails) throw new Error("GitHub refused the push");
    saved.push(project);
    messages.push(message);
    state = { ...state, repo: "https://github.com/ana/acme", changes: 0 };
    return state.repo;
  }),
  githubSignIn: vi.fn(async () => {
    const { useGitHub } = await import("./github");
    useGitHub.getState().onCode("1A2B-3C4D");
    expect(useGitHub.getState().code).toBe("1A2B-3C4D");
  }),
}));

const { useLog } = await import("./log");
const { useApp } = await import("./app");
const { useCompany } = await import("./company");
const { UNKNOWN, useGitHub } = await import("./github");

const P = "p1";
const github = () => useGitHub.getState().byProject[P] ?? UNKNOWN;

describe("a company's code on GitHub", () => {
  beforeEach(() => {
    state = { gh: true, account: "ana", repo: null, changes: 3 };
    pushFails = false;
    saved.length = 0;
    useGitHub.setState({ byProject: {}, signingIn: false, code: null });
    useLog.setState({ byProject: {} });
  });

  it("puts it on GitHub the first time and says so in the timeline", async () => {
    await useGitHub.getState().load(P);
    expect(github().state).toMatchObject({ repo: null, changes: 3 });
    await useGitHub.getState().save(P);
    expect(github()).toMatchObject({ saving: false, state: { repo: "https://github.com/ana/acme", changes: 0 } });
    expect(useLog.getState().byProject[P].map((e) => [e.text, e.url])).toEqual([["the code is on GitHub, private", "https://github.com/ana/acme"]]);
  });

  it("shows gh's code only while its sign-in runs", async () => {
    await useGitHub.getState().signIn(P);
    expect(useGitHub.getState()).toMatchObject({ signingIn: false, code: null });
  });

  it("backs up quietly once the repo is there, and never makes one on its own", async () => {
    await useGitHub.getState().backup(P);
    expect(saved, "no repo yet: the owner puts it on GitHub").toEqual([]);
    state = { ...state, account: null };
    useGitHub.setState({ byProject: {} });
    await useGitHub.getState().backup(P);
    expect(saved, "not connected").toEqual([]);

    state = { gh: true, account: "ana", repo: "https://github.com/ana/acme", changes: 2 };
    useGitHub.setState({ byProject: {} });
    await useGitHub.getState().backup(P);
    expect(saved).toEqual([P]);
    expect(github()).toMatchObject({ saving: false, error: null, state: { changes: 0 } });
    expect(github().backedUpAt).toBeGreaterThan(0);
    expect(useLog.getState().byProject[P], "no timeline line per backup").toBeUndefined();

    pushFails = true;
    await useGitHub.getState().backup(P);
    expect(github()).toMatchObject({ saving: false, error: "Error: GitHub refused the push" });
  });

  it("saves with the owner's message", async () => {
    await useGitHub.getState().save(P, "Add the pricing page");
    expect(messages[messages.length - 1]).toBe("Add the pricing page");
  });

  it("has the company's agent write the message from what changed, reading only", async () => {
    useApp.setState({ projects: [{ id: P, name: "Acme", folder: "/tmp/acme" }] as never, clis: [{ engine: "claude", installed: true }] as never });
    useCompany.setState({ choice: { engine: "claude", model: "opus" } as never });
    expect(await useGitHub.getState().writeMessage(P)).toBe("Add the pricing page");
    expect(runStep.mock.calls[runStep.mock.calls.length - 1][0]).toMatchObject({ step: "commit", task: " M app/page.tsx" });
    expect(github().writing).toBeNull();
  });

  it("writes nothing when nothing changed", async () => {
    changes = "";
    runStep.mockClear();
    expect(await useGitHub.getState().writeMessage(P)).toBeNull();
    expect(runStep).not.toHaveBeenCalled();
    changes = " M app/page.tsx";
  });
});
