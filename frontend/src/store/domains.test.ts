import { beforeEach, describe, expect, it, vi } from "vitest";

const live = { value: false };

vi.mock("@/lib/api", () => ({
  siteDomains: vi.fn(async () => ({ domains: [], records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=acme" }] })),
  addSiteDomain: vi.fn(async (_: string, domain: string) => {
    if (!domain.includes(".")) throw new Error("That isn't a domain dhrive can connect");
    return { domains: [{ domain, live: false }], records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=acme" }] };
  }),
  checkSiteDomain: vi.fn(async (_: string, domain: string) => ({ domains: [{ domain, live: live.value }], records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=acme" }] })),
  removeSiteDomain: vi.fn(async () => ({ domains: [], records: [{ kind: "A", value: "179.236.65.28" }, { kind: "TXT", value: "dhrive=acme" }] })),
}));

const { useLog } = await import("./log");
const { NO_DOMAINS, useDomains } = await import("./domains");

const P = "p1";
const own = () => useDomains.getState().byProject[P] ?? NO_DOMAINS;

describe("a company's own domains", () => {
  beforeEach(() => {
    live.value = false;
    useDomains.setState({ byProject: {} });
    useLog.setState({ byProject: {} });
  });

  it("waits for the DNS, then says when the domain goes live", async () => {
    expect(await useDomains.getState().add(P, " acme.com ")).toBe(true);
    expect(own()).toMatchObject({ domains: [{ domain: "acme.com", live: false }], records: [{ value: "179.236.65.28" }, { value: "dhrive=acme" }], busy: null });
    await useDomains.getState().check(P, "acme.com");
    expect(useLog.getState().byProject[P]).toBeUndefined();
    live.value = true;
    await useDomains.getState().check(P, "acme.com");
    expect(useLog.getState().byProject[P].map((e) => [e.kind, e.text, e.url])).toEqual([["published", "acme.com is live", "https://acme.com"]]);
  });

  it("says why the host refused", async () => {
    expect(await useDomains.getState().add(P, "acme")).toBe(false);
    expect(own().error).toContain("isn't a domain");
  });
});
