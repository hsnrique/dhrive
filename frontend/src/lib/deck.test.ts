import { describe, expect, it } from "vitest";

import { columnCount, columnsFor } from "./deck";

describe("columnCount", () => {
  it("fits as many columns as the room holds, from one to three", () => {
    expect(columnCount(0)).toBe(1);
    expect(columnCount(600)).toBe(1);
    expect(columnCount(652)).toBe(2);
    expect(columnCount(966)).toBe(3);
    expect(columnCount(2400)).toBe(3);
  });
});

describe("columnsFor", () => {
  it("places every section exactly once, leading with what's happening", () => {
    for (const count of [1, 2, 3]) {
      const placed = columnsFor(count);
      expect(placed).toHaveLength(count);
      expect(placed.flat().sort()).toEqual(["brief", "documents", "environment", "overview", "tasks", "website"]);
      expect(placed[0][0]).toBe("overview");
    }
    expect(columnsFor(2)[0]).toContain("tasks");
  });
});
