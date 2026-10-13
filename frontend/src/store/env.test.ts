import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvView } from "@/lib/api";

const EMPTY: EnvView = { vars: [], missing: ["STRIPE_SECRET_KEY"], removed: [] };
const envSet = vi.fn(async (_p: string, name: string): Promise<EnvView> => ({ vars: [{ name, hint: "4f2a", public: false }], missing: [], removed: [] }));

vi.mock("@/lib/api", () => ({
  envView: vi.fn(async () => EMPTY),
  envSet,
  envRemove: vi.fn(async () => {
    throw "That variable is already gone.";
  }),
  envRestore: vi.fn(async () => EMPTY),
}));

const { useEnv } = await import("./env");
const P = "p1";

describe("a company's environment", () => {
  beforeEach(() => useEnv.setState({ byProject: {}, errorOf: {} }));

  it("shows what the vault says after every change", async () => {
    await useEnv.getState().load(P);
    expect(useEnv.getState().byProject[P].missing).toEqual(["STRIPE_SECRET_KEY"]);
    expect(await useEnv.getState().set(P, "  STRIPE_SECRET_KEY ", "sk_test_x")).toBe(true);
    expect(envSet).toHaveBeenLastCalledWith(P, "STRIPE_SECRET_KEY", "sk_test_x");
    expect(useEnv.getState().byProject[P].vars).toEqual([{ name: "STRIPE_SECRET_KEY", hint: "4f2a", public: false }]);
  });

  it("keeps the last good view and says what went wrong", async () => {
    await useEnv.getState().load(P);
    await useEnv.getState().remove(P, "GONE");
    expect(useEnv.getState().errorOf[P]).toBe("That variable is already gone.");
    expect(useEnv.getState().byProject[P]).toEqual(EMPTY);
    await useEnv.getState().load(P);
    expect(useEnv.getState().errorOf[P]).toBeNull();
  });
});
