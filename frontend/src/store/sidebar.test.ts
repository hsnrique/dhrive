import { beforeEach, describe, expect, it, vi } from "vitest";

import { save } from "@/lib/storage";
import { initialsOf, sidebarMode, useSidebar } from "./sidebar";

vi.mock("@/lib/storage", () => ({ readSaved: vi.fn(() => null), save: vi.fn() }));

describe("sidebarMode", () => {
  it("docks on a wide window as the owner left it, and opens over the work on a narrow one", () => {
    expect(sidebarMode(true, true, false)).toBe("docked");
    expect(sidebarMode(false, true, true)).toBe("rail");
    expect(sidebarMode(true, false, false), "a narrow window never docks it").toBe("rail");
    expect(sidebarMode(false, false, true)).toBe("overlay");
  });
});

describe("useSidebar", () => {
  beforeEach(() => useSidebar.setState({ open: true, overlay: false }));

  it("folds and unfolds on a wide window, and remembers it", () => {
    useSidebar.getState().toggle(true);
    expect(useSidebar.getState().open).toBe(false);
    expect(save).toHaveBeenLastCalledWith("sidebar.open", false);
    useSidebar.getState().toggle(true);
    expect(useSidebar.getState().open).toBe(true);
  });

  it("on a narrow window only opens it over the work, leaving the owner's choice alone", () => {
    useSidebar.getState().toggle(false);
    expect(useSidebar.getState()).toMatchObject({ open: true, overlay: true });
    useSidebar.getState().fold();
    expect(useSidebar.getState().overlay).toBe(false);
  });
});

describe("initialsOf", () => {
  it("gives two letters that tell companies apart", () => {
    expect(["PageParcel", "ProofNest", "sys-app", "Cognit", "ftvly", "  ", "Ação Rápida"].map(initialsOf)).toEqual(["PP", "PN", "SA", "Co", "Ft", "?", "AR"]);
  });
});
