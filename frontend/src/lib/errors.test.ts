import { describe, expect, it } from "vitest";

import { MAX_SHOWN, withError } from "./errors";

describe("the errors on screen", () => {
  it("keeps the earlier ones, newest first, up to a few", () => {
    let shown = withError([], "Couldn't save COMPANY.md", 1);
    shown = withError(shown, "The network is down", 2);
    expect(shown.map((e) => e.text)).toEqual(["The network is down", "Couldn't save COMPANY.md"]);
    for (let i = 3; i < 10; i++) shown = withError(shown, `error ${i}`, i);
    expect(shown).toHaveLength(MAX_SHOWN);
    expect(shown[0].text).toBe("error 9");
  });

  it("counts the same message again instead of showing it twice", () => {
    let shown = withError(withError([], "Offline", 1), "Disk full", 2);
    shown = withError(shown, "Offline", 3);
    expect(shown).toEqual([{ id: 3, text: "Offline", count: 2 }, { id: 2, text: "Disk full", count: 1 }]);
  });
});
