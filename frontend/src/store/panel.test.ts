import { beforeEach, describe, expect, it } from "vitest";

import { MAX_WIDTH, tabKey, usePanel } from "./panel";

const panel = () => usePanel.getState();

describe("the side panel", () => {
  beforeEach(() => usePanel.setState({ tabs: [], active: null }));

  it("opens a file once, and a second open just brings it forward", () => {
    panel().open("/a", "src/theme.ts");
    panel().open("/a", "README.md");
    panel().open("/a", "src/theme.ts");
    expect(panel().tabs.map((t) => t.path)).toEqual(["src/theme.ts", "README.md"]);
    expect(panel().active).toBe("/a::src/theme.ts");
  });

  it("walks a folder tab into a subfolder in place", () => {
    panel().open("/a", "");
    panel().navigate({ folder: "/a", path: "" }, "src/");
    expect(panel().tabs).toEqual([{ folder: "/a", path: "src/" }]);
    expect(panel().active).toBe("/a::src/");
  });

  it("closing the active tab moves to its neighbour in the same project", () => {
    panel().open("/a", "one.ts");
    panel().open("/b", "other.ts");
    panel().open("/a", "two.ts");
    panel().close({ folder: "/a", path: "two.ts" });
    expect(panel().active).toBe(tabKey({ folder: "/a", path: "one.ts" }));
    panel().close({ folder: "/a", path: "one.ts" });
    expect(panel().active).toBeNull();
    expect(panel().tabs).toEqual([{ folder: "/b", path: "other.ts" }]);
  });

  it("keeps its width within bounds", () => {
    panel().setWidth(5000);
    expect(panel().width).toBe(MAX_WIDTH);
  });
});
