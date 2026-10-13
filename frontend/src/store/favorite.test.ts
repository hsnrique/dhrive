import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, string>([["dhrive.site.favorite", JSON.stringify({ p1: "acme.com", p2: 42, p3: "old.com" })]]);
vi.stubGlobal("localStorage", { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) });

const folders = new Map<string, unknown>();
const readCompanyRecord = vi.fn(async (project: string, _name: string) => folders.get(project) ?? null);
const saveCompanyRecord = vi.fn(async (project: string, _name: string, value: unknown) => void folders.set(project, value));
vi.mock("@/lib/api", () => ({ readCompanyRecord, saveCompanyRecord }));

const { useFavorite } = await import("./favorite");
const favorite = (id: string) => useFavorite.getState().byProject[id];

describe("a company's favorite address", () => {
  beforeEach(() => {
    folders.clear();
    saveCompanyRecord.mockClear();
  });

  it("shows what this webview remembered until the folder answers, and only names come back", () => {
    expect(favorite("p1")).toBe("acme.com");
    expect(favorite("p2")).toBeUndefined();
  });

  it("comes from the company's folder, which wins over the webview", async () => {
    folders.set("p1", { favorite: "shop.acme.com" });
    await useFavorite.getState().load("p1");
    expect(favorite("p1")).toBe("shop.acme.com");
    expect(saveCompanyRecord).not.toHaveBeenCalled();
  });

  it("moves a star from before the folder kept it into the folder, once", async () => {
    await useFavorite.getState().load("p3");
    expect(folders.get("p3")).toEqual({ favorite: "old.com" });
    expect(favorite("p3")).toBe("old.com");
  });

  it("is saved to the folder when picked", async () => {
    useFavorite.getState().pick("p2", "beta.dhrive.site");
    expect(favorite("p2")).toBe("beta.dhrive.site");
    expect(saveCompanyRecord).toHaveBeenCalledWith("p2", "site", { favorite: "beta.dhrive.site" });
  });

  it("never writes over a record it couldn't read", async () => {
    readCompanyRecord.mockRejectedValueOnce("The company's site file is damaged");
    await useFavorite.getState().load("p3");
    expect(saveCompanyRecord).not.toHaveBeenCalled();
  });
});
