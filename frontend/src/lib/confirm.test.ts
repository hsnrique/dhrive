import { describe, expect, it } from "vitest";

import { confirmed } from "./confirm";

describe("confirmed", () => {
  it("takes the name as typed, ignoring case and stray spaces, and nothing short of it", () => {
    expect(confirmed(" Acme.com ", "acme.com")).toBe(true);
    expect(confirmed("acme", "acme.com")).toBe(false);
    expect(confirmed("", "")).toBe(false);
    expect(confirmed("storefront", "storefront")).toBe(true);
  });
});
