import { describe, expect, it } from "vitest";

import { turns } from "./turns";

describe("turns", () => {
  it("lets one holder per key go at a time, in order, and other keys right through", async () => {
    const t = turns();
    const order: string[] = [];
    const first = await t.take("/shop");
    const second = t.take("/shop").then((release) => {
      order.push("second");
      release();
    });
    const other = t.take("/blog").then((release) => {
      order.push("other");
      release();
    });
    await other;
    expect(order).toEqual(["other"]);
    expect(t.busy("/shop")).toBe(true);
    order.push("first done");
    first();
    await second;
    expect(order).toEqual(["other", "first done", "second"]);
    await Promise.resolve();
    expect(t.busy("/shop")).toBe(false);
  });
});
