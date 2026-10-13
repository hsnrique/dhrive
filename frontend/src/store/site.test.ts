import { beforeEach, describe, expect, it, vi } from "vitest";

let backend = { app: true, running: false, port: null as number | null, log: [] as string[] };
const runSite = vi.fn(async () => void (backend = { ...backend, running: true }));
const stopSite = vi.fn(async () => void (backend = { ...backend, running: false, port: null }));

vi.mock("@/lib/api", () => ({ siteState: vi.fn(async () => backend), runSite, stopSite }));

const { useSite } = await import("./site");
const site = () => useSite.getState().byProject.p1;

describe("a company's website, Play and Stop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backend = { app: true, running: false, port: null, log: [] };
    useSite.setState({ byProject: {} });
  });

  it("Play starts it and keeps asking until its address shows; Stop ends it and stops asking", async () => {
    await useSite.getState().play("p1");
    expect(runSite).toHaveBeenCalledWith("p1");
    expect(site()).toMatchObject({ running: true, port: null, busy: false });
    backend = { ...backend, port: 3000 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(site().port).toBe(3000);
    await useSite.getState().stop("p1");
    expect(site()).toMatchObject({ running: false, port: null });
    backend = { ...backend, running: true };
    await vi.advanceTimersByTimeAsync(5000);
    expect(site().running).toBe(false);
  });

  it("says why it couldn't start", async () => {
    runSite.mockRejectedValueOnce("This company has no website to run yet.");
    await useSite.getState().play("p1");
    expect(site().error).toBe("This company has no website to run yet.");
  });
});
