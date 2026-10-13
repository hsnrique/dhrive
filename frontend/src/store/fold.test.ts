import { describe, expect, it } from "vitest";

import { useFolds } from "./fold";

describe("useFolds", () => {
  it("keeps what was unfolded by key, so a card built anew opens as it was", () => {
    const { set } = useFolds.getState();
    expect(useFolds.getState().open["task:a"]).toBeUndefined();
    set("task:a", true);
    set("doc:p:mission", true);
    set("task:a", false);
    expect(useFolds.getState().open).toEqual({ "task:a": false, "doc:p:mission": true });
  });
});
