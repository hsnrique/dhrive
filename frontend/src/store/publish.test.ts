import { beforeEach, describe, expect, it, vi } from "vitest";

const publishSite = vi.fn(async (_project: string) => ({ url: "https://acme.dhrive.site" }));
const buildSite = vi.fn(async (_project: string) => undefined);
const sitePublished = vi.fn(async (_project: string): Promise<{ url: string; at: number } | null> => ({ url: "https://acme.dhrive.site", at: 1791400000000 }));
vi.mock("@/lib/api", () => ({ publishSite, buildSite, sitePublished }));

const { useLog } = await import("./log");
const { usePublish } = await import("./publish");
const published = () => usePublish.getState().byProject.p1;
const log = () => useLog.getState().byProject.p1 ?? [];

describe("publishing a company's website", () => {
  beforeEach(() => {
    usePublish.setState({ byProject: {} });
    useLog.setState({ byProject: {} });
  });

  it("keeps the live address once it's up", async () => {
    await usePublish.getState().publish("p1");
    expect(publishSite).toHaveBeenCalledWith("p1");
    expect(published()).toMatchObject({ url: "https://acme.dhrive.site", busy: false, error: null });
  });

  it("says why it couldn't, and keeps the address it had", async () => {
    await usePublish.getState().publish("p1");
    publishSite.mockRejectedValueOnce("Couldn't reach dhrive's site host.");
    await usePublish.getState().publish("p1");
    expect(published()).toMatchObject({ url: "https://acme.dhrive.site", error: "Couldn't reach dhrive's site host." });
  });

  it("builds alone, and a failed build goes to the timeline with its output", async () => {
    expect(await usePublish.getState().build("p1")).toBe(true);
    expect(published().builtAt).toBeGreaterThan(0);
    buildSite.mockRejectedValueOnce("The website didn't build:\nType error in page.tsx");
    expect(await usePublish.getState().build("p1")).toBe(false);
    expect(published()).toMatchObject({ building: false, error: "The website didn't build" });
    expect(log().map((e) => [e.kind, e.detail])).toEqual([["build", "Type error in page.tsx"]]);
  });

  it("a publish whose build fails says so the same way", async () => {
    publishSite.mockRejectedValueOnce("The website didn't build:\nModule not found");
    await usePublish.getState().publish("p1");
    expect(log().map((e) => [e.kind, e.detail])).toEqual([["build", "Module not found"]]);
  });

  it("learns where the site lives from the host, though this install never published it", async () => {
    await usePublish.getState().sync("p1");
    expect(published()).toMatchObject({ url: "https://acme.dhrive.site", at: 1791400000000 });
  });

  it("forgets an address the host no longer serves", async () => {
    await usePublish.getState().publish("p1");
    sitePublished.mockResolvedValueOnce(null);
    await usePublish.getState().sync("p1");
    expect(published().url).toBeNull();
  });

  it("keeps the remembered address when the host can't be asked", async () => {
    await usePublish.getState().publish("p1");
    sitePublished.mockRejectedValueOnce("Couldn't reach dhrive's site host.");
    await usePublish.getState().sync("p1");
    expect(published()).toMatchObject({ url: "https://acme.dhrive.site", error: null });
  });
});
