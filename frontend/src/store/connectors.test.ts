import { beforeEach, describe, expect, it, vi } from "vitest";

const folders = new Map<string, unknown>();
let damaged = false;
const readCompanyRecord = vi.fn(async (project: string) => {
  if (damaged) throw new Error("The company's connectors file is damaged");
  return folders.get(project) ?? null;
});
const saveCompanyRecord = vi.fn(async (project: string, _name: string, value: unknown) => void folders.set(project, value));
vi.mock("@/lib/api", () => ({
  connectors: vi.fn(async () => [{ id: "supabase", name: "Supabase", what: "Database", group: "Code and data", site: "https://supabase.com" }]),
  readCompanyRecord,
  saveCompanyRecord,
}));

const { useConnectors } = await import("./connectors");
const connected = () => useConnectors.getState().byProject.p1 ?? {};

describe("the tools a company connected", () => {
  beforeEach(() => {
    folders.clear();
    damaged = false;
    saveCompanyRecord.mockClear();
    useConnectors.setState({ byProject: {} });
  });

  it("come from the company's folder, with the catalog", async () => {
    folders.set("p1", { stripe: { at: 5 }, junk: true });
    await useConnectors.getState().load("p1");
    expect(useConnectors.getState().catalog.map((c) => c.id)).toEqual(["supabase"]);
    expect(connected()).toEqual({ stripe: { at: 5 } });
  });

  it("are added to the folder's record when a setup finishes", async () => {
    folders.set("p1", { stripe: { at: 5 } });
    await useConnectors.getState().connected("p1", "supabase");
    expect(Object.keys(folders.get("p1") as object).sort()).toEqual(["stripe", "supabase"]);
  });

  it("never write over a record that can't be read", async () => {
    damaged = true;
    await useConnectors.getState().connected("p1", "supabase");
    expect(saveCompanyRecord).not.toHaveBeenCalled();
    expect(Object.keys(connected())).toEqual(["supabase"]);
  });
});
