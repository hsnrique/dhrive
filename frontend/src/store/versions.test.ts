import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  siteReleases: vi.fn(async () => [{ at: 3, live: true }, { at: 2, live: false }, { at: 1, live: false }]),
  makeReleaseLive: vi.fn(async (_: string, at: number) => {
    if (at === 9) throw new Error("That version isn't kept anymore.");
  }),
}));

const { useLog } = await import("./log");
const { usePublish } = await import("./publish");
const { UNKNOWN, useVersions } = await import("./versions");

const P = "p1";
const versions = () => useVersions.getState().byProject[P] ?? UNKNOWN;

describe("a website's versions", () => {
  beforeEach(() => {
    useVersions.setState({ byProject: {} });
    useLog.setState({ byProject: {} });
    usePublish.setState({ byProject: { [P]: { url: "https://acme.dhrive.site", at: 0, busy: false, building: false, builtAt: null, error: null } } });
  });

  it("puts an earlier one back live and says so in the timeline", async () => {
    await useVersions.getState().load(P);
    await useVersions.getState().makeLive(P, 1);
    expect(versions().releases!.map((r) => r.live)).toEqual([false, false, true]);
    const said = useLog.getState().byProject[P][0];
    expect(said).toMatchObject({ kind: "published", url: "https://acme.dhrive.site" });
    expect(said.text).toContain("is live again");
  });

  it("keeps the live one as it was when the host refuses", async () => {
    await useVersions.getState().load(P);
    await useVersions.getState().makeLive(P, 9);
    expect(versions()).toMatchObject({ moving: null, error: expect.stringContaining("isn't kept") });
    expect(versions().releases![0].live).toBe(true);
  });
});
