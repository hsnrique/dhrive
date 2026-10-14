import { describe, expect, it } from "vitest";

import { total } from "./cart";

describe("a cart", () => {
  it("adds its lines", () => {
    expect(total([{ sku: "mug", priceCents: 1200, quantity: 1 }, { sku: "tee", priceCents: 2500, quantity: 1 }])).toBe(3700);
  });
});
